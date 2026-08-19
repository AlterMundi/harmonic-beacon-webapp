#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const PROVIDERS = new Set(['google', 'apple']);
const ENVIRONMENTS = new Set(['staging', 'production']);
const MAX_APPLE_LIFETIME_SECONDS = 183 * 24 * 60 * 60;

function assignments(contents, label) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) throw new Error(`${label} contains an invalid assignment`);
    const key = line.slice(0, at);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) {
      throw new Error(`${label} contains an invalid or duplicate key`);
    }
    values.set(key, line.slice(at + 1));
  }
  return values;
}

function decodeCanonicalBase64UrlJSON(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} is invalid`);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error(`${label} is not canonical`);
  return JSON.parse(decoded.toString('utf8'));
}

function validateGoogle(clientId, clientSecret) {
  if (!/^[A-Za-z0-9._-]{8,480}\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Google client ID is invalid');
  }
  if (clientSecret.length < 16 || clientSecret.length > 512 || /\s/.test(clientSecret)) {
    throw new Error('Google client secret is invalid');
  }
}

function validateApple(clientId, clientSecret, nowSeconds) {
  if (!/^[A-Za-z0-9.-]{3,255}$/.test(clientId)) throw new Error('Apple Services ID is invalid');
  const parts = clientSecret.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('Apple client secret is invalid');
  let header;
  let payload;
  try {
    header = decodeCanonicalBase64UrlJSON(parts[0], 'Apple JWT header');
    payload = decodeCanonicalBase64UrlJSON(parts[1], 'Apple JWT payload');
  } catch {
    throw new Error('Apple client secret is invalid');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2]) || Buffer.from(parts[2], 'base64url').length !== 64 ||
      Buffer.from(parts[2], 'base64url').toString('base64url') !== parts[2]) {
    throw new Error('Apple client secret is invalid');
  }
  if (header.alg !== 'ES256' || typeof header.kid !== 'string' ||
      !/^[A-Z0-9]{10}$/.test(header.kid)) {
    throw new Error('Apple client secret header is invalid');
  }
  if (typeof payload.iss !== 'string' || !/^[A-Z0-9]{10}$/.test(payload.iss) ||
      payload.sub !== clientId ||
      payload.aud !== 'https://appleid.apple.com' || !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) || payload.iat > nowSeconds + 300 ||
      payload.exp <= nowSeconds || payload.exp <= payload.iat ||
      payload.exp - payload.iat > MAX_APPLE_LIFETIME_SECONDS) {
    throw new Error('Apple client secret claims are invalid');
  }
}

function replaceExact(contents, key, value) {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  let count = 0;
  const updated = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line;
    count += 1;
    return `${key}=${value}`;
  });
  if (count !== 1) throw new Error(`Account environment must contain exactly one ${key}`);
  return updated.join('\n');
}

export function buildSocialProviderActivation({
  accountContents,
  bundleContents,
  environment,
  provider,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!ENVIRONMENTS.has(environment)) throw new Error('environment must be staging or production');
  if (!PROVIDERS.has(provider)) throw new Error('provider must be google or apple');
  const upper = provider.toUpperCase();
  const account = assignments(accountContents, 'Account environment');
  const bundle = assignments(bundleContents, 'provider bundle');
  const expectedOrigin = environment === 'staging'
    ? 'https://account-staging.harmonicbeacon.com'
    : 'https://account.harmonicbeacon.com';
  if (account.get('BEACON_ACCOUNT_BASE_URL') !== expectedOrigin) {
    throw new Error('Account environment issuer mismatch');
  }
  const flagKey = `BEACON_ACCOUNT_${upper}_ENABLED`;
  const idKey = `BEACON_ACCOUNT_${upper}_CLIENT_ID`;
  const secretKey = `BEACON_ACCOUNT_${upper}_CLIENT_SECRET`;
  if (account.get(flagKey) !== '0' || (account.get(idKey) ?? '') !== '' ||
      (account.get(secretKey) ?? '') !== '') {
    throw new Error('target provider must be fully disabled before first activation');
  }
  const expectedBundleKeys = new Set([idKey, secretKey]);
  if (bundle.size !== expectedBundleKeys.size ||
      [...bundle.keys()].some((key) => !expectedBundleKeys.has(key))) {
    throw new Error('provider bundle must contain only the exact provider client ID and secret');
  }
  const clientId = bundle.get(idKey) ?? '';
  const clientSecret = bundle.get(secretKey) ?? '';
  if (provider === 'google') validateGoogle(clientId, clientSecret);
  else validateApple(clientId, clientSecret, nowSeconds);

  let result = accountContents;
  result = replaceExact(result, idKey, clientId);
  result = replaceExact(result, secretKey, clientSecret);
  result = replaceExact(result, flagKey, '1');
  const effective = assignments(result, 'activated Account environment');
  if (effective.get(flagKey) !== '1' || effective.get(idKey) !== clientId ||
      effective.get(secretKey) !== clientSecret) {
    throw new Error('provider activation output is inconsistent');
  }
  return result.endsWith('\n') ? result : `${result}\n`;
}

function requireRootPrivateFile(file, label) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be root:root mode 0600`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [accountFile, bundleFile, outputFile, environment, provider] = process.argv.slice(2);
  if (!accountFile || !bundleFile || !outputFile || !environment || !provider) {
    throw new Error('usage: social-provider-env.mjs account.env bundle.env output.env staging|production google|apple');
  }
  requireRootPrivateFile(accountFile, 'Account environment');
  requireRootPrivateFile(bundleFile, 'provider bundle');
  if (fs.existsSync(outputFile)) throw new Error('activation output already exists');
  const directory = fs.lstatSync(path.dirname(outputFile));
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 ||
      directory.gid !== 0 || (directory.mode & 0o777) !== 0o700) {
    throw new Error('activation output directory must be root:root mode 0700');
  }
  const result = buildSocialProviderActivation({
    accountContents: fs.readFileSync(accountFile, 'utf8'),
    bundleContents: fs.readFileSync(bundleFile, 'utf8'),
    environment,
    provider,
  });
  fs.writeFileSync(outputFile, result, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`Beacon Account ${provider} activation environment prepared for ${environment}.\n`);
}
