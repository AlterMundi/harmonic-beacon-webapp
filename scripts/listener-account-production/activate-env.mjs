#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const SHA40 = /^[0-9a-f]{40}$/;
const BUILD_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SCHEMA = /^\d{14}_[a-z0-9_]+$/;
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;

function assignments(contents, label) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) throw new Error(`${label} contains an invalid assignment`);
    const key = line.slice(0, at);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`${label} contains an invalid key`);
    if (values.has(key)) throw new Error(`${label} contains a duplicate key`);
    values.set(key, line.slice(at + 1));
  }
  return values;
}

function exact(values, key, expected, label) {
  if (values.get(key) !== expected) throw new Error(`${label} ${key} mismatch`);
}

function replaceAssignment(contents, key, value) {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  let replacements = 0;
  const updated = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line;
    replacements += 1;
    return `${key}=${value}`;
  });
  if (replacements > 1) throw new Error(`Listener environment contains duplicate ${key}`);
  if (replacements === 0) {
    if (updated.at(-1) !== '') updated.push('');
    updated.splice(updated.length - 1, 0, `${key}=${value}`);
  }
  return updated.join('\n');
}

export function buildProductionActivation({
  listenerContents,
  bundleContents,
  expectedSha,
  buildTime,
  expectedSchema,
}) {
  if (!SHA40.test(expectedSha)) throw new Error('exact lowercase sha40 required');
  if (!BUILD_TIME.test(buildTime)) throw new Error('exact UTC build time required');
  if (!SCHEMA.test(expectedSchema)) throw new Error('exact schema migration required');
  const listener = assignments(listenerContents, 'Listener environment');
  const bundle = assignments(bundleContents, 'Listener Account bundle');

  if ((listener.get('BEACON_LISTENER_ACCOUNT_ENABLED') ?? '0') !== '0') {
    throw new Error('Listener environment BEACON_LISTENER_ACCOUNT_ENABLED must be absent or 0');
  }
  exact(listener, 'EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.harmonicbeacon.com', 'Listener environment');
  exact(
    listener,
    'EARLY_BIRDS_TRUSTED_ORIGINS',
    'https://listen.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com',
    'Listener environment',
  );
  for (const key of [
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING',
  ]) {
    if ((listener.get(key) ?? '') !== '') throw new Error(`Listener environment ${key} must be empty`);
  }

  const allowedBundle = new Set([
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
  ]);
  for (const key of bundle.keys()) {
    if (!allowedBundle.has(key)) throw new Error('Listener Account bundle contains unexpected keys');
  }
  if (bundle.size !== allowedBundle.size) throw new Error('Listener Account bundle is incomplete');
  const clientSecret = bundle.get('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET');
  const stateSecret = bundle.get('BEACON_LISTENER_ACCOUNT_STATE_SECRET');
  if (!SECRET.test(clientSecret ?? '') || !SECRET.test(stateSecret ?? '')) {
    throw new Error('Listener Account bundle contains an invalid secret');
  }
  if (clientSecret === stateSecret) throw new Error('Listener Account secrets must differ');

  let result = listenerContents;
  for (const [key, value] of [
    ['EARLYBIRDS_PREVIEW_IMAGE_TAG', expectedSha],
    ['EARLYBIRDS_PREVIEW_GIT_SHA', expectedSha],
    ['EARLYBIRDS_PREVIEW_BUILD_TIME', buildTime],
    ['EARLYBIRDS_PREVIEW_SCHEMA_VERSION', expectedSchema],
    // Central Account is the sole identity provider after this cutover. Keep
    // the old direct-provider and magic-link credentials out of the process;
    // the root-only previous env retains them only for bounded rollback.
    ['EARLY_BIRDS_GOOGLE_CLIENT_ID', ''],
    ['EARLY_BIRDS_GOOGLE_CLIENT_SECRET', ''],
    ['BEACON_LISTENER_APPLE_ENABLED', '0'],
    ['BEACON_LISTENER_APPLE_CLIENT_ID', ''],
    ['BEACON_LISTENER_APPLE_CLIENT_SECRET', ''],
    ['EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL', ''],
    ['EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN', ''],
    ['EARLY_BIRDS_MAGIC_LINK_RATE_SECRET', ''],
    ['BEACON_LISTENER_ACCOUNT_ENABLED', '1'],
    ['BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', clientSecret],
    ['BEACON_LISTENER_ACCOUNT_STATE_SECRET', stateSecret],
  ]) {
    result = replaceAssignment(result, key, value);
  }
  const effective = assignments(result, 'activated Listener environment');
  exact(effective, 'BEACON_LISTENER_ACCOUNT_ENABLED', '1', 'activated Listener environment');
  exact(effective, 'EARLYBIRDS_PREVIEW_IMAGE_TAG', expectedSha, 'activated Listener environment');
  exact(effective, 'EARLYBIRDS_PREVIEW_GIT_SHA', expectedSha, 'activated Listener environment');
  exact(effective, 'EARLYBIRDS_PREVIEW_SCHEMA_VERSION', expectedSchema, 'activated Listener environment');
  exact(effective, 'EARLY_BIRDS_GOOGLE_CLIENT_ID', '', 'activated Listener environment');
  exact(effective, 'EARLY_BIRDS_GOOGLE_CLIENT_SECRET', '', 'activated Listener environment');
  exact(effective, 'BEACON_LISTENER_APPLE_ENABLED', '0', 'activated Listener environment');
  exact(effective, 'BEACON_LISTENER_APPLE_CLIENT_ID', '', 'activated Listener environment');
  exact(effective, 'BEACON_LISTENER_APPLE_CLIENT_SECRET', '', 'activated Listener environment');
  exact(effective, 'EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL', '', 'activated Listener environment');
  exact(effective, 'EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN', '', 'activated Listener environment');
  exact(effective, 'EARLY_BIRDS_MAGIC_LINK_RATE_SECRET', '', 'activated Listener environment');
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
  const [listenerFile, bundleFile, outputFile, expectedSha, buildTime, expectedSchema] = process.argv.slice(2);
  if (!listenerFile || !bundleFile || !outputFile || !expectedSha || !buildTime || !expectedSchema) {
    throw new Error('usage: activate-env.mjs listener.env account.env output.env sha40 build-time schema');
  }
  requireRootPrivateFile(listenerFile, 'Listener environment');
  requireRootPrivateFile(bundleFile, 'Listener Account bundle');
  if (fs.existsSync(outputFile)) throw new Error('activation output already exists');
  const outputDirectory = fs.lstatSync(path.dirname(outputFile));
  if (!outputDirectory.isDirectory() || outputDirectory.isSymbolicLink()) {
    throw new Error('activation output directory must be regular');
  }
  if (outputDirectory.uid !== 0 || outputDirectory.gid !== 0 || (outputDirectory.mode & 0o777) !== 0o700) {
    throw new Error('activation output directory must be root:root mode 0700');
  }
  const candidate = buildProductionActivation({
    listenerContents: fs.readFileSync(listenerFile, 'utf8'),
    bundleContents: fs.readFileSync(bundleFile, 'utf8'),
    expectedSha,
    buildTime,
    expectedSchema,
  });
  fs.writeFileSync(outputFile, candidate, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write('Listener production Account activation environment prepared.\n');
}
