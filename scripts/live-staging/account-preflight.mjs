#!/usr/bin/env node

import { lstat, readFile } from 'node:fs/promises';

const ISSUER = 'https://account-staging.harmonicbeacon.com';
const LIVE_ORIGIN = 'https://live-staging.harmonicbeacon.com';
const CLIENT_ID = 'hb-live-staging';
const SECRET_ENV = '/etc/harmonic-beacon/live-staging-secrets/account.env';

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
        if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) fail('invalid or duplicate environment key');
        values.set(key, value);
    }
    return values;
}

async function rootOnlyEnv(path) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o777) !== 0o600) {
        fail(`${path} must be a root:root mode-0600 regular file`);
    }
    return parseEnv(await readFile(path, 'utf8'));
}

async function jsonResponse(url, init) {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    const body = await response.json().catch(() => fail(`${url} did not return JSON`));
    return { response, body };
}

async function main() {
    if (process.getuid?.() !== 0) fail('run as root');
    const mode = process.argv[2] ?? 'prepared';
    if (!['prepared', 'public'].includes(mode) || process.argv.length > 3) {
        fail('usage: account-preflight.mjs [prepared|public]');
    }
    const rp = await rootOnlyEnv(SECRET_ENV);
    const rpSecret = rp.get('BEACON_ACCOUNT_CLIENT_SECRET') ?? '';
    if (rpSecret.length < 32 || /[\r\n\0]/.test(rpSecret)) fail('Live staging client secret is invalid');

    const { response: discoveryResponse, body: discovery } = await jsonResponse(
        `${ISSUER}/.well-known/openid-configuration`,
        { headers: { Accept: 'application/json' } },
    );
    if (!discoveryResponse.ok || discovery.issuer !== ISSUER) fail('Account staging discovery unavailable or mismatched');
    const endpoints = {
        authorization_endpoint: '/api/account/auth/oauth2/authorize',
        token_endpoint: '/api/account/auth/oauth2/token',
        jwks_uri: '/.well-known/jwks.json',
        userinfo_endpoint: '/api/account/auth/oauth2/userinfo',
        introspection_endpoint: '/api/account/auth/oauth2/introspect',
        end_session_endpoint: '/api/account/auth/oauth2/end-session',
    };
    for (const [name, path] of Object.entries(endpoints)) {
        if (discovery[name] !== `${ISSUER}${path}`) fail(`Account discovery ${name} mismatch`);
    }
    if (!discovery.code_challenge_methods_supported?.includes('S256') ||
        !discovery.token_endpoint_auth_methods_supported?.includes('client_secret_basic')) {
        fail('Account discovery does not advertise the frozen RP contract');
    }
    const { response: jwksResponse, body: jwks } = await jsonResponse(
        `${ISSUER}/.well-known/jwks.json`,
        { headers: { Accept: 'application/json' } },
    );
    if (!jwksResponse.ok || !Array.isArray(jwks.keys) || jwks.keys.length < 1 ||
        jwks.keys.some((key) => typeof key !== 'object' || key === null || typeof key.kid !== 'string')) {
        fail('Account staging JWKS unavailable or invalid');
    }
    const basic = Buffer.from(`${CLIENT_ID}:${rpSecret}`, 'utf8').toString('base64');
    const { response: statusResponse, body: status } = await jsonResponse(
        `${ISSUER}/api/account/session-status`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ sid: 'live-staging-preflight', sub: 'live-staging-preflight' }),
        },
    );
    if (!statusResponse.ok || status.active !== false ||
        !statusResponse.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
        fail('Account session-status client authentication failed');
    }

    if (mode === 'public') {
        const ready = await fetch(`${LIVE_ORIGIN}/api/health/ready`, {
            cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8_000),
        });
        const body = await ready.json().catch(() => fail('Live staging readiness did not return JSON'));
        if (!ready.ok || ready.headers.get('x-harmonic-beacon-environment') !== 'live-staging' ||
            body?.status !== 'ok' || body?.checks?.database !== 'ok' || body?.checks?.account !== 'ok') {
            fail('public Live staging Account readiness mismatch');
        }
    }
    process.stdout.write(`Live staging Account ${mode} preflight passed without exposing secrets.\n`);
}

main().catch((error) => {
    process.stderr.write(`Live staging Account preflight failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
});
