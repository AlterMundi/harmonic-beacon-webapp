#!/usr/bin/env node
/**
 * Loads db/test-fixture.sql into the database named by E2E_DATABASE_URL (or
 * DATABASE_URL), via psql from the same postgres:16-alpine image the rest of
 * the e2e stack uses — the dump contains COPY blocks and psql meta-commands
 * that a plain SQL driver cannot replay. Docker is already a requirement of
 * the e2e stack (Postgres + LiveKit containers), so this adds nothing new.
 *
 * The dump is a full schema+data restore of the pinned test fixture — point
 * it only at a throwaway database, never at production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The dump is not a --clean dump, so reset the schema first to keep the
// loader idempotent (safe here: the guard above pins throwaway databases).
const sql = `DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
${readFileSync(join(root, 'db', 'test-fixture.sql'), 'utf8')}

-- The committed fixture keeps stable historical event timestamps so visual
-- and lifecycle assertions remain deterministic. Authentication, however,
-- must not start failing merely because wall-clock time moved past that
-- historical weekend. Refresh only non-revoked test entitlements in this
-- throwaway database; production data can never reach this guarded loader.
UPDATE public.ticket_entitlements
SET expires_at = GREATEST(expires_at, CURRENT_TIMESTAMP + INTERVAL '24 hours')
WHERE state <> 'REVOKED' AND revoked_at IS NULL;
`;
const connectionString = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
    console.error('Set E2E_DATABASE_URL (or DATABASE_URL) to a throwaway database.');
    process.exit(1);
}

let target;
try {
    target = new URL(connectionString);
} catch {
    console.error('Refusing to load the fixture: the database URL is invalid.');
    process.exit(1);
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !localHosts.has(target.hostname) ||
    databaseName !== 'beacon_test'
) {
    console.error(
        'Refusing to load the fixture: target must be PostgreSQL on localhost/127.0.0.1/::1 with database name exactly beacon_test.',
    );
    process.exit(1);
}

// --network host so `localhost` in the URL resolves like it does for the app
// (the e2e stack is Linux-based: CI runner and dev containers).
const psql = spawn(
    'docker',
    [
        'run', '--rm', '-i', '--network', 'host',
        'postgres:16-alpine',
        'psql', connectionString, '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null',
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
);
psql.on('error', (error) => {
    console.error(`could not start docker psql: ${error.message}`);
    process.exit(1);
});
psql.stdin.end(sql, () => {
    psql.on('exit', (code) => {
        if (code === 0) {
            console.log('fixture loaded');
        }
        process.exit(code ?? 1);
    });
});
