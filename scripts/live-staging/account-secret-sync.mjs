#!/usr/bin/env node

import { chmod, chown, lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const AUTHORITY_ENV = '/etc/harmonic-beacon/account.staging.env';
const LIVE_ENV = '/etc/harmonic-beacon/live-staging.env';
const TARGET_ENV = '/etc/harmonic-beacon/live-staging-secrets/account.env';
const AUTHORITY_KEY = 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING';
const TARGET_KEY = 'BEACON_ACCOUNT_CLIENT_SECRET';

function fail(message) {
    throw new Error(message);
}

function parseEnv(contents) {
    const values = new Map();
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) fail('invalid environment file');
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1);
        if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) {
            fail('invalid or duplicate environment key');
        }
        values.set(key, value);
    }
    return values;
}

async function requireRootOnly(path) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o777) !== 0o600) {
        fail(`${path} must be a root:root mode-0600 regular file`);
    }
}

async function main() {
    if (process.getuid?.() !== 0) fail('run as root');
    if (process.argv.length !== 2) fail('this command accepts no paths or secret values');
    await requireRootOnly(AUTHORITY_ENV);
    await requireRootOnly(LIVE_ENV);
    const targetDirectory = await lstat('/etc/harmonic-beacon/live-staging-secrets');
    if (!targetDirectory.isDirectory() || targetDirectory.uid !== 0 || targetDirectory.gid !== 0 ||
        (targetDirectory.mode & 0o777) !== 0o700) {
        fail('/etc/harmonic-beacon/live-staging-secrets must be a root:root mode-0700 directory');
    }
    const authority = parseEnv(await readFile(AUTHORITY_ENV, 'utf8'));
    const live = parseEnv(await readFile(LIVE_ENV, 'utf8'));
    if (live.get('BEACON_ACCOUNT_ENABLED') !== 'false') {
        fail('BEACON_ACCOUNT_ENABLED must remain false while synchronizing the staging secret');
    }
    if (live.get('BEACON_ACCOUNT_ISSUER_URL') !== 'https://account-staging.harmonicbeacon.com') {
        fail('Live staging issuer is not exact');
    }
    if (live.get('BEACON_ACCOUNT_CLIENT_ID') !== 'hb-live-staging') {
        fail('Live staging client ID is not exact');
    }
    const secret = authority.get(AUTHORITY_KEY) ?? '';
    if (secret.length < 32 || /[\r\n\0]/.test(secret)) fail('authority staging client secret is invalid');

    const temporary = `${TARGET_ENV}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
        await writeFile(temporary, `${TARGET_KEY}=${secret}\n`, { mode: 0o600, flag: 'wx' });
        await chown(temporary, 0, 0);
        await chmod(temporary, 0o600);
        await rename(temporary, TARGET_ENV);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    await requireRootOnly(TARGET_ENV);
    process.stdout.write('Live staging Account client secret synchronized; feature flag remains OFF.\n');
}

main().catch((error) => {
    process.stderr.write(`Live staging Account secret sync failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
});
