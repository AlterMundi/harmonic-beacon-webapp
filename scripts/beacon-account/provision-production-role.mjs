#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

import pg from 'pg';

const EXPECTED_HOST = 'earlybirds-preview-postgres';
const EXPECTED_DATABASE = 'earlybirds_preview';
const RUNTIME_ROLE = 'account_prod';
const ROLE_LOCK = 7_393_011_842;

const runtimeTables = [
  'early_bird_users',
  'early_bird_auth_sessions',
  'early_bird_identities',
  'early_bird_verifications',
  'beacon_account_authority_environment',
  'beacon_profiles',
  'beacon_account_action_tokens',
  'beacon_account_auth_throttles',
  'beacon_account_mail_outbox',
  'listener_account_sessions',
  'beacon_oauth_clients',
  'beacon_oauth_refresh_tokens',
  'beacon_oauth_access_tokens',
  'beacon_oauth_consents',
  'beacon_jwks',
];

const triggerFunctions = [
  'beacon_profile_after_account_insert',
  'beacon_verification_outbox_after_identity_insert',
];

function databaseUrlFromEnvFile(file) {
  const matches = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line.startsWith('DATABASE_URL='));
  if (matches.length !== 1) throw new Error('runtime database file must contain exactly one DATABASE_URL');
  return new URL(matches[0].slice('DATABASE_URL='.length));
}

function validateUrl(url, role, label, expectedHost) {
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== expectedHost ||
      url.pathname.slice(1) !== EXPECTED_DATABASE ||
      (url.searchParams.get('schema') ?? 'public') !== 'public') {
    throw new Error(`${label} database boundary mismatch`);
  }
  if (decodeURIComponent(url.username) !== role) throw new Error(`${label} database role mismatch`);
  const password = decodeURIComponent(url.password);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) {
    throw new Error(`${label} database password must be 32-128 base64url characters`);
  }
  return password;
}

async function formattedRolePassword(client, password) {
  const result = await client.query(
    "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS statement",
    [RUNTIME_ROLE, password],
  );
  return result.rows[0].statement;
}

export async function provisionProductionRole({
  adminUrl,
  runtimeEnvFile,
  expectedHost = EXPECTED_HOST,
}) {
  const runtimeUrl = databaseUrlFromEnvFile(runtimeEnvFile);
  const runtimePassword = validateUrl(runtimeUrl, RUNTIME_ROLE, 'runtime', expectedHost);
  const parsedAdminUrl = new URL(adminUrl);
  validateUrl(parsedAdminUrl, 'earlybirds_preview', 'migration', expectedHost);

  const client = new pg.Client({ connectionString: parsedAdminUrl.toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ROLE_LOCK]);
    const authority = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser
    `);
    if (authority.rows[0]?.database !== EXPECTED_DATABASE ||
        authority.rows[0]?.role !== 'earlybirds_preview' ||
        authority.rows[0]?.superuser !== true) {
      throw new Error('migration connection is not the exact production database authority');
    }

    const existing = await client.query(
      'SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [RUNTIME_ROLE],
    );
    if (existing.rowCount === 0) await client.query('CREATE ROLE account_prod LOGIN');
    else if (Object.values(existing.rows[0]).some(Boolean)) {
      throw new Error('runtime database role has forbidden elevated attributes');
    }
    const memberships = await client.query(`
      SELECT count(*)::integer AS count
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid = membership.member
      WHERE member.rolname = $1
    `, [RUNTIME_ROLE]);
    if (memberships.rows[0].count !== 0) throw new Error('runtime database role must not inherit another role');

    await client.query(await formattedRolePassword(client, runtimePassword));
    await client.query(`
      ALTER ROLE account_prod NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS INHERIT;
      ALTER ROLE account_prod SET search_path = public;
      GRANT CONNECT ON DATABASE earlybirds_preview TO account_prod;
      GRANT USAGE ON SCHEMA public TO account_prod;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM account_prod;
      REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM account_prod;
    `);

    const objects = await client.query(
      'SELECT name FROM unnest($1::text[]) AS expected(name) WHERE to_regclass(format(\'public.%I\', name)) IS NULL',
      [runtimeTables],
    );
    if (objects.rowCount !== 0) throw new Error('required Account runtime table is missing after migration');
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${runtimeTables
      .map((name) => `"${name}"`).join(', ')} TO account_prod`);
    for (const name of triggerFunctions) {
      const present = await client.query('SELECT to_regprocedure($1) IS NOT NULL AS present', [`${name}()`]);
      if (!present.rows[0].present) throw new Error('required Account trigger function is missing after migration');
      await client.query(`GRANT EXECUTE ON FUNCTION "${name}"() TO account_prod`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const runtime = new pg.Client({ connectionString: runtimeUrl.toString() });
  await runtime.connect();
  try {
    const check = await runtime.query(`
      SELECT current_database() AS database, current_user AS role,
             to_regclass('public.beacon_account_authority_environment') IS NOT NULL AS authority
    `);
    if (check.rows[0]?.database !== EXPECTED_DATABASE ||
        check.rows[0]?.role !== RUNTIME_ROLE || check.rows[0]?.authority !== true) {
      throw new Error('runtime database role verification failed');
    }
  } finally {
    await runtime.end();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const runtimeEnvFile = process.argv[2];
  if (!runtimeEnvFile || !process.env.DATABASE_URL) {
    throw new Error('usage: DATABASE_URL=<migration-url> provision-production-role.mjs runtime-database.env');
  }
  provisionProductionRole({ adminUrl: process.env.DATABASE_URL, runtimeEnvFile })
    .then(() => process.stdout.write('Account production runtime database role is ready.\n'))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'role provisioning failed'}\n`);
      process.exitCode = 1;
    });
}
