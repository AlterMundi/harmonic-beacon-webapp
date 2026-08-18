#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PROD_ORIGIN = 'https://account.harmonicbeacon.com';
const STAGING_ORIGIN = 'https://account-staging.harmonicbeacon.com';
const MAIL_URL = 'http://listener-mail-api:8765/api/internal/v1/listener-account-mail/deliver';

export function parseEnvFile(file) {
  const result = new Map();
  for (const [index, source] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) throw new Error(`${path.basename(file)}:${index + 1}: invalid assignment`);
    const key = line.slice(0, equals);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || result.has(key)) {
      throw new Error(`${path.basename(file)}:${index + 1}: duplicate or invalid key`);
    }
    result.set(key, line.slice(equals + 1));
  }
  return result;
}

function required(env, key, minimum = 1) {
  const value = env.get(key) ?? '';
  if (value.length < minimum) throw new Error(`${key} is missing or too short`);
  return value;
}

function validateDatabase(raw, expected) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must identify PostgreSQL');
  }
  if ((url.searchParams.get('schema') ?? 'public') !== expected.schema) {
    throw new Error(`DATABASE_URL must use schema=${expected.schema}`);
  }
  if (url.hostname !== expected.host || url.pathname.slice(1) !== expected.database) {
    throw new Error(`DATABASE_URL must use isolated ${expected.host}/${expected.database}`);
  }
  return {
    identity: `${url.hostname}:${url.port || '5432'}${url.pathname}?schema=${expected.schema}`,
    url,
  };
}

function assertRealSecret(value, key, allowPlaceholders) {
  if (!allowPlaceholders && /^(?:replace|change|example|test|changeme)(?:-|_|$)/i.test(value)) {
    throw new Error(`${key} is still a placeholder`);
  }
}

function assertBase64Url32(value, key) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`${key} must be unpadded base64url for exactly 32 bytes`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    throw new Error(`${key} must be canonical unpadded base64url for exactly 32 bytes`);
  }
}

function validateEnvironment(env, kind, allowPlaceholders, stagingDatabaseEnv) {
  const production = kind === 'production';
  const origin = production ? PROD_ORIGIN : STAGING_ORIGIN;
  if (required(env, 'BEACON_ACCOUNT_RUNTIME') !== '1') throw new Error('Account runtime gate must be 1');
  if (required(env, 'BEACON_ACCOUNT_BASE_URL') !== origin) throw new Error(`${kind} Account origin mismatch`);
  if (required(env, 'BEACON_ACCOUNT_PROVISION_CONFIRM_ISSUER') !== origin) {
    throw new Error(`${kind} provision confirmation mismatch`);
  }
  if (required(env, 'BEACON_ACCOUNT_TRUSTED_ORIGINS') !== origin) {
    throw new Error(`${kind} trusted origins must contain only its own origin`);
  }
  for (const key of [
    'BEACON_ACCOUNT_AUTH_SECRET', 'BEACON_ACCOUNT_RATE_SECRET',
    'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN', 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY',
  ]) {
    const secret = required(env, key, 32);
    assertRealSecret(secret, key, allowPlaceholders);
  }
  assertBase64Url32(required(env, 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY'), 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY');
  if (required(env, 'BEACON_ACCOUNT_MAIL_DELIVERY_URL') !== MAIL_URL) {
    throw new Error('Account mail URL must use the exact private endpoint');
  }
  for (const provider of ['GOOGLE', 'APPLE']) {
    const gate = required(env, `BEACON_ACCOUNT_${provider}_ENABLED`);
    if (!['0', '1'].includes(gate)) throw new Error(`${provider} gate must be 0 or 1`);
    const id = env.get(`BEACON_ACCOUNT_${provider}_CLIENT_ID`) ?? '';
    const secret = env.get(`BEACON_ACCOUNT_${provider}_CLIENT_SECRET`) ?? '';
    if ((gate === '1') !== Boolean(id && secret)) throw new Error(`${provider} gate and credentials disagree`);
    if (gate === '1') {
      assertRealSecret(id, `BEACON_ACCOUNT_${provider}_CLIENT_ID`, allowPlaceholders);
      assertRealSecret(secret, `BEACON_ACCOUNT_${provider}_CLIENT_SECRET`, allowPlaceholders);
    }
  }
  const active = production
    ? ['BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE']
    : ['BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING'];
  const inactive = production
    ? ['BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING']
    : ['BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE'];
  active.forEach((key) => {
    const secret = required(env, key, 32);
    assertRealSecret(secret, key, allowPlaceholders);
  });
  inactive.forEach((key) => {
    if (env.get(key)) throw new Error(`${key} must be empty outside its issuer`);
  });
  const database = validateDatabase(required(env, 'DATABASE_URL'), production
    ? { host: 'earlybirds-preview-postgres', database: 'earlybirds_preview', schema: 'public' }
    : { host: 'account-staging-postgres', database: 'beacon_account_staging', schema: 'public' });
  if (!production) {
    assertRealSecret(required(stagingDatabaseEnv, 'POSTGRES_PASSWORD', 32), 'POSTGRES_PASSWORD', allowPlaceholders);
    if (!stagingDatabaseEnv ||
        required(stagingDatabaseEnv, 'POSTGRES_USER') !== decodeURIComponent(database.url.username) ||
        required(stagingDatabaseEnv, 'POSTGRES_PASSWORD') !== decodeURIComponent(database.url.password) ||
        required(stagingDatabaseEnv, 'POSTGRES_DB') !== database.url.pathname.slice(1)) {
      throw new Error('staging PostgreSQL bootstrap values and DATABASE_URL disagree');
    }
  }
  const secretKeys = [
    'BEACON_ACCOUNT_AUTH_SECRET', 'BEACON_ACCOUNT_RATE_SECRET',
    'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN', 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY', ...active,
    ...['GOOGLE', 'APPLE'].flatMap((provider) =>
      (env.get(`BEACON_ACCOUNT_${provider}_ENABLED`) === '1'
        ? [`BEACON_ACCOUNT_${provider}_CLIENT_SECRET`] : [])),
  ];
  const seen = new Map();
  for (const key of secretKeys) {
    const value = env.get(key) ?? '';
    if (!value) continue;
    const previous = seen.get(value);
    if (previous) throw new Error(`${key} must differ from ${previous}`);
    seen.set(value, key);
  }
  return database.identity;
}

const WORKER_KEYS = new Set([
  'DATABASE_URL',
  'BEACON_ACCOUNT_BASE_URL',
  'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN',
  'BEACON_ACCOUNT_MAIL_OUTBOX_KEY',
]);

function validateWorkerEnvironment(worker, application, kind, allowPlaceholders) {
  for (const key of worker.keys()) {
    if (!WORKER_KEYS.has(key)) throw new Error(`${kind} mail worker contains forbidden key ${key}`);
  }
  for (const key of WORKER_KEYS) {
    const value = required(worker, key, key.includes('TOKEN') || key.includes('KEY') ? 32 : 1);
    if (value !== application.get(key)) {
      throw new Error(`${kind} mail worker ${key} must match the Account application value`);
    }
  }
  assertRealSecret(required(worker, 'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN', 32),
    'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN', allowPlaceholders);
  assertRealSecret(required(worker, 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY', 32),
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY', allowPlaceholders);
  assertBase64Url32(required(worker, 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY'),
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY');
}

export function validatePair(
  productionFile,
  stagingFile,
  stagingDatabaseFile,
  allowPlaceholders = false,
  productionWorkerFile = path.join(ROOT, 'account-mail-worker.production.env.example'),
  stagingWorkerFile = path.join(ROOT, 'account-mail-worker.staging.env.example'),
) {
  const production = parseEnvFile(productionFile);
  const staging = parseEnvFile(stagingFile);
  const stagingDatabaseEnvironment = parseEnvFile(stagingDatabaseFile);
  const productionWorker = parseEnvFile(productionWorkerFile);
  const stagingWorker = parseEnvFile(stagingWorkerFile);
  const productionDatabase = validateEnvironment(production, 'production', allowPlaceholders, null);
  const stagingDatabase = validateEnvironment(staging, 'staging', allowPlaceholders, stagingDatabaseEnvironment);
  validateWorkerEnvironment(productionWorker, production, 'production', allowPlaceholders);
  validateWorkerEnvironment(stagingWorker, staging, 'staging', allowPlaceholders);
  if (productionDatabase === stagingDatabase) throw new Error('production and staging DATABASE_URL must be isolated');
  for (const key of [
    'BEACON_ACCOUNT_AUTH_SECRET', 'BEACON_ACCOUNT_RATE_SECRET',
    'BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN', 'BEACON_ACCOUNT_MAIL_OUTBOX_KEY',
  ]) {
    if (production.get(key) === staging.get(key)) throw new Error(`${key} must differ between issuers`);
  }
  const productionSecrets = new Map([...production]
    .filter(([key, value]) => value && /(?:SECRET|TOKEN|PASSWORD)/.test(key))
    .map(([key, value]) => [value, key]));
  for (const [key, value] of staging) {
    if (!value || !/(?:SECRET|TOKEN|PASSWORD)/.test(key)) continue;
    const productionKey = productionSecrets.get(value);
    if (productionKey) throw new Error(`${key} must differ from production ${productionKey}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const productionFile = process.argv[2] ?? path.join(ROOT, 'account.production.env.example');
  const stagingFile = process.argv[3] ?? path.join(ROOT, 'account.staging.env.example');
  const stagingDatabaseFile = process.argv[4] ?? path.join(ROOT, 'database.staging.env.example');
  const productionWorkerFile = process.argv[5] ?? path.join(ROOT, 'account-mail-worker.production.env.example');
  const stagingWorkerFile = process.argv[6] ?? path.join(ROOT, 'account-mail-worker.staging.env.example');
  const canonicalExamples = [
    path.join(ROOT, 'account.production.env.example'),
    path.join(ROOT, 'account.staging.env.example'),
    path.join(ROOT, 'database.staging.env.example'),
    path.join(ROOT, 'account-mail-worker.production.env.example'),
    path.join(ROOT, 'account-mail-worker.staging.env.example'),
  ].map((value) => fs.realpathSync(value));
  const requestedFiles = [
    productionFile, stagingFile, stagingDatabaseFile, productionWorkerFile, stagingWorkerFile,
  ].map((value) => fs.realpathSync(value));
  const examples = requestedFiles.every((value, index) => value === canonicalExamples[index]);
  validatePair(
    productionFile, stagingFile, stagingDatabaseFile, examples,
    productionWorkerFile, stagingWorkerFile,
  );
}
