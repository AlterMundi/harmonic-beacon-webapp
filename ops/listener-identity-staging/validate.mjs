#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SHA40 = /^[0-9a-f]{40}$/;
const MIGRATION = /^[0-9]{14}_[a-z0-9_]+$/;
const STAGING_ORIGIN = 'https://earlybirds-staging.harmonicbeacon.com';

export function parseEnvFile(file) {
  const result = new Map();
  for (const [index, raw] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`${path.basename(file)}:${index + 1}: invalid assignment`);
    const key = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || result.has(key)) {
      throw new Error(`${path.basename(file)}:${index + 1}: duplicate or invalid key`);
    }
    result.set(key, line.slice(separator + 1));
  }
  return result;
}

function required(env, key, minimum = 1) {
  const value = env.get(key) ?? '';
  if (value.length < minimum) throw new Error(`${key} is missing or too short`);
  return value;
}

function exact(env, key, expected) {
  if (required(env, key) !== expected) throw new Error(`${key} must be ${expected}`);
}

function secret(env, key, minimum, allowPlaceholders) {
  const value = required(env, key, minimum);
  if (!allowPlaceholders && /^(?:replace|example|synthetic|changeme)(?:-|_|$)/i.test(value)) {
    throw new Error(`${key} is still a placeholder`);
  }
  return value;
}

export function validateSharedStreamSecret(value, allowPlaceholders = false) {
  if (value.length < 32) throw new Error('EARLY_BIRDS_STREAM_SIGNING_SECRET is missing or too short');
  if (allowPlaceholders) return value;
  if (value.startsWith('synthetic-')) {
    if (!/^synthetic-[0-9a-f]{64}$/.test(value)) {
      throw new Error('EARLY_BIRDS_STREAM_SIGNING_SECRET synthetic prefix requires 64 random hex characters');
    }
    return value;
  }
  if (/^(?:replace|example|changeme)(?:-|_|$)/i.test(value)) {
    throw new Error('EARLY_BIRDS_STREAM_SIGNING_SECRET is still a placeholder');
  }
  return value;
}

function exactRootPath(env, key, expected) {
  const value = required(env, key);
  if (value !== expected || !path.isAbsolute(value)) throw new Error(`${key} must be ${expected}`);
}

function validateDeploy(env) {
  exact(env, 'COMPOSE_PROJECT_NAME', 'listener-identity-staging');
  const tag = required(env, 'LISTENER_IDENTITY_STAGING_IMAGE_TAG');
  const sha = required(env, 'LISTENER_IDENTITY_STAGING_GIT_SHA');
  if (!SHA40.test(tag) || tag !== sha) throw new Error('image tag and git SHA must be the same lowercase sha40');
  const builtAt = required(env, 'LISTENER_IDENTITY_STAGING_BUILD_TIME');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(builtAt) || !Number.isFinite(Date.parse(builtAt))) {
    throw new Error('LISTENER_IDENTITY_STAGING_BUILD_TIME must be an ISO UTC timestamp');
  }
  const schema = required(env, 'LISTENER_IDENTITY_STAGING_SCHEMA_VERSION');
  if (!MIGRATION.test(schema) || !fs.existsSync(path.join(ROOT, 'prisma/migrations', schema, 'migration.sql'))) {
    throw new Error('schema version must name a checked-in migration');
  }
  exact(env, 'LISTENER_IDENTITY_STAGING_APP_PORT', '13001');
  exactRootPath(env, 'LISTENER_IDENTITY_STAGING_APP_ENV_FILE', '/etc/harmonic-beacon/listener-identity-staging.env');
  exactRootPath(env, 'LISTENER_IDENTITY_STAGING_DATABASE_ENV_FILE', '/etc/harmonic-beacon/listener-identity-staging-database.env');
  exactRootPath(env, 'LISTENER_IDENTITY_STAGING_BACKUP_DIR', '/mnt/beacon-data/listener-identity-staging/backups');
  exactRootPath(env, 'LISTENER_IDENTITY_STAGING_STATE_DIR', '/var/lib/harmonic-beacon/listener-identity-staging');
  const artifacts = required(env, 'BEACON_STREAM_ARTIFACTS_HOST_PATH');
  if (!path.isAbsolute(artifacts) || artifacts === '/') throw new Error('artifact path must be a bounded absolute path');
  const geoip = required(env, 'BEACON_LISTENER_GEOIP_HOST_PATH');
  if (!path.isAbsolute(geoip) || !geoip.endsWith('/dbip-country-lite-2026-07.mmdb')) {
    throw new Error('GeoIP path must be the reviewed July 2026 country database');
  }
}

function validateDatabase(env, allowPlaceholders) {
  exact(env, 'POSTGRES_USER', 'listener_identity_staging');
  exact(env, 'POSTGRES_DB', 'listener_identity_staging');
  return secret(env, 'POSTGRES_PASSWORD', 24, allowPlaceholders);
}

function validatePair(env, first, second, label) {
  const a = env.get(first) ?? '';
  const b = env.get(second) ?? '';
  if (Boolean(a) !== Boolean(b)) throw new Error(`${label} values must be configured together`);
  return [a, b];
}

function validateApplication(env, databasePassword, allowPlaceholders) {
  exact(env, 'NODE_ENV', 'production');
  const database = new URL(required(env, 'DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== 'listener-identity-staging-postgres' ||
      database.pathname !== '/listener_identity_staging' ||
      decodeURIComponent(database.username) !== 'listener_identity_staging' ||
      decodeURIComponent(database.password) !== databasePassword ||
      database.searchParams.get('schema') !== 'public') {
    throw new Error('DATABASE_URL must use only the dedicated staging PostgreSQL service');
  }

  exact(env, 'BEACON_LISTENER_ENABLED', '1');
  exact(env, 'BEACON_LISTENER_FREE_FOR_ALL', '0');
  exact(env, 'BEACON_LISTENER_AUTH_BASE_URL', STAGING_ORIGIN);
  exact(env, 'BEACON_LISTENER_TRUSTED_ORIGINS', STAGING_ORIGIN);
  secret(env, 'BEACON_LISTENER_AUTH_SECRET', 32, allowPlaceholders);
  validatePair(env, 'BEACON_LISTENER_GOOGLE_CLIENT_ID', 'BEACON_LISTENER_GOOGLE_CLIENT_SECRET', 'Google OAuth');
  exact(env, 'BEACON_LISTENER_APPLE_ENABLED', '0');
  const apple = validatePair(env, 'BEACON_LISTENER_APPLE_CLIENT_ID', 'BEACON_LISTENER_APPLE_CLIENT_SECRET', 'Apple OAuth');
  if (apple.some(Boolean)) throw new Error('Apple must remain empty while its staging provider is disabled');
  exact(env, 'BEACON_LISTENER_TEST_ACCESS_ENABLED', '0');
  secret(env, 'BEACON_LISTENER_TEST_LOGIN_SECRET', 32, allowPlaceholders);
  exact(env, 'BEACON_LISTENER_STAGING_TEAM_ENTRY_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_STAGING_TEAM_ENTRY_HOSTS', 'earlybirds-staging.harmonicbeacon.com');

  const accountEnabled = required(env, 'BEACON_LISTENER_ACCOUNT_ENABLED');
  if (!['0', '1'].includes(accountEnabled)) {
    throw new Error('BEACON_LISTENER_ACCOUNT_ENABLED must be 0 or 1');
  }
  exact(env, 'BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'staging');
  for (const forbidden of [
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
  ]) {
    if (env.has(forbidden)) throw new Error(`${forbidden} production secret must be absent from staging`);
  }
  const account = validatePair(
    env,
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING',
    'staging Account RP',
  );
  if (accountEnabled === '1' && account.some((value) => !value)) {
    throw new Error('staging Account RP secrets are required when Account is enabled');
  }
  if (account.some((value) => value && value.length < 32) || (account[0] && account[0] === account[1])) {
    throw new Error('staging Account RP secrets must be distinct and at least 32 characters');
  }
  if (!allowPlaceholders) account.filter(Boolean).forEach((value) => {
    if (/^(?:replace|example|synthetic|changeme)(?:-|_|$)/i.test(value)) {
      throw new Error('staging Account RP secret is still a placeholder');
    }
  });

  exact(env, 'EARLY_BIRDS_AUTHORITY_BASE_URL', 'http://pmp-myth-api:8765');
  exact(env, 'EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID', 'listener-identity-staging-v1');
  const authorityToken = secret(env, 'EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN', 43, allowPlaceholders);
  exact(env, 'EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID', 'listener-identity-staging-v1');
  const inboundToken = secret(env, 'EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT', 43, allowPlaceholders);
  if (authorityToken === inboundToken) throw new Error('outbound and inbound authority tokens must differ');
  exact(env, 'EARLY_BIRDS_STREAM_ORIGIN', 'https://stream.harmonicbeacon.com');
  exact(env, 'EARLY_BIRDS_STREAM_CONTROL_ORIGIN', 'http://beacon-stream:8080');
  if (![
    'beacon-luz-20260624-aac320-v1',
    'beacon-luz-20260624-2hs-aac320-v2',
  ].includes(required(env, 'EARLY_BIRDS_STREAM_ARTIFACT_ID'))) {
    throw new Error('stream artifact is not an approved Listener artifact');
  }
  validateSharedStreamSecret(required(env, 'EARLY_BIRDS_STREAM_SIGNING_SECRET'), allowPlaceholders);
  secret(env, 'EARLY_BIRDS_DEVICE_PEPPER', 32, allowPlaceholders);
  exact(env, 'BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED', '0');
  exact(env, 'LISTENER_WITHDRAWAL_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED', '0');
  exact(env, 'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED', '0');
  for (const key of [
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID',
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER',
    'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET',
  ]) {
    if (env.get(key)) throw new Error(`${key} must be empty`);
  }
  exact(env, 'BEACON_LISTENER_GEOIP_DB_PATH', '/data/geoip/dbip-country-lite.mmdb');
  exact(env, 'TRUSTED_PROXY_HOPS', '1');
}

export function validateFiles(deployFile, appFile, databaseFile, allowPlaceholders = false) {
  const deploy = parseEnvFile(deployFile);
  const app = parseEnvFile(appFile);
  const database = parseEnvFile(databaseFile);
  validateDeploy(deploy);
  const password = validateDatabase(database, allowPlaceholders);
  validateApplication(app, password, allowPlaceholders);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const allowPlaceholders = args[0] === '--allow-placeholders';
  const offset = allowPlaceholders ? 1 : 0;
  const deployFile = args[offset];
  const appFile = args[offset + 1];
  const databaseFile = args[offset + 2];
  if (!deployFile || !appFile || !databaseFile || args.length !== offset + 3) {
    throw new Error('usage: validate.mjs [--allow-placeholders] DEPLOY_ENV APP_ENV DATABASE_ENV');
  }
  validateFiles(deployFile, appFile, databaseFile, allowPlaceholders);
}
