#!/usr/bin/env node

import { lstat, readFile } from 'node:fs/promises';
import { CLIENT_ID, ISSUER, TARGET_ENV, parseEnv, validateTarget } from './account-env.mjs';

const LIVE_ORIGIN = 'https://live.harmonicbeacon.com';

function fail(message) {
    throw new Error(message);
}

function exactSha(value) {
    if (!/^[0-9a-f]{40}$/.test(value ?? '')) fail('exact Account SHA required');
    return value;
}

function exactSchema(value) {
    if (!/^[0-9]{14}_[a-z0-9_]+$/.test(value ?? '')) fail('exact Account schema required');
    return value;
}

async function rootOnlyBundle() {
    const metadata = await lstat(TARGET_ENV);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 ||
        (metadata.mode & 0o777) !== 0o600) {
        fail(`${TARGET_ENV} must be a root:root mode-0600 regular file`);
    }
    return validateTarget(parseEnv(await readFile(TARGET_ENV, 'utf8')));
}

async function jsonResponse(url, init = {}) {
    const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => fail(`${url} did not return JSON`));
    return { response, body };
}

async function main() {
    if (process.getuid?.() !== 0) fail('run as root');
    const mode = process.argv[2] ?? '';
    const accountSha = exactSha(process.argv[3]);
    const accountSchema = exactSchema(process.argv[4]);
    if (!['prepared', 'public'].includes(mode) || process.argv.length !== 5) {
        fail('usage: account-preflight.mjs prepared|public account-sha40 account-schema');
    }
    const bundle = await rootOnlyBundle();
    const rpSecret = bundle.get('BEACON_ACCOUNT_CLIENT_SECRET');

    const { response: readyResponse, body: ready } = await jsonResponse(`${ISSUER}/api/account/health/ready`);
    if (!readyResponse.ok || ready.status !== 'ok' || ready.gitSha !== accountSha ||
        ready.schemaVersion !== accountSchema || ready.checks?.database !== 'ok' || ready.checks?.mail !== 'ok' ||
        ready.checks?.issuer !== 'ok' || ready.checks?.jwks !== 'ok' || ready.checks?.clients !== 'ok' ||
        ready.checks?.providers !== 'ok') {
        fail('Account production readiness or provenance mismatch');
    }

    const { response: discoveryResponse, body: discovery } = await jsonResponse(
        `${ISSUER}/.well-known/openid-configuration`,
        { headers: { Accept: 'application/json' } },
    );
    const endpoints = {
        authorization_endpoint: '/api/account/auth/oauth2/authorize',
        token_endpoint: '/api/account/auth/oauth2/token',
        jwks_uri: '/.well-known/jwks.json',
        userinfo_endpoint: '/api/account/auth/oauth2/userinfo',
        introspection_endpoint: '/api/account/auth/oauth2/introspect',
        end_session_endpoint: '/api/account/auth/oauth2/end-session',
    };
    if (!discoveryResponse.ok || discovery.issuer !== ISSUER) fail('Account production discovery mismatch');
    for (const [name, path] of Object.entries(endpoints)) {
        if (discovery[name] !== `${ISSUER}${path}`) fail(`Account discovery ${name} mismatch`);
    }
    if (!Array.isArray(discovery.code_challenge_methods_supported) ||
        discovery.code_challenge_methods_supported.length !== 1 ||
        discovery.code_challenge_methods_supported[0] !== 'S256' ||
        !Array.isArray(discovery.token_endpoint_auth_methods_supported) ||
        discovery.token_endpoint_auth_methods_supported.length !== 1 ||
        discovery.token_endpoint_auth_methods_supported[0] !== 'client_secret_basic') {
        fail('Account discovery does not advertise the frozen RP contract');
    }

    const { response: jwksResponse, body: jwks } = await jsonResponse(`${ISSUER}/.well-known/jwks.json`);
    if (!jwksResponse.ok || !Array.isArray(jwks.keys) || jwks.keys.length < 1 ||
        jwks.keys.some((key) => typeof key !== 'object' || key === null || typeof key.kid !== 'string' ||
            key.kid.length < 1 || key.kty !== 'OKP' || key.alg !== 'EdDSA' || key.crv !== 'Ed25519' ||
            typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || 'd' in key ||
            ('use' in key && key.use !== 'sig') ||
            ('key_ops' in key && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))) ||
        new Set(jwks.keys.map((key) => key?.kid)).size !== jwks.keys.length) {
        fail('Account production JWKS unavailable or invalid');
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
            body: new URLSearchParams({ sid: 'live-production-preflight', sub: 'live-production-preflight' }),
        },
    );
    if (!statusResponse.ok || status.active !== false ||
        !statusResponse.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
        fail('Account production session-status client authentication failed');
    }

    if (mode === 'public') {
        const { response, body } = await jsonResponse(`${LIVE_ORIGIN}/api/health/ready`);
        if (!response.ok || body.status !== 'ok' || body.checks?.database !== 'ok' || body.checks?.account !== 'ok') {
            fail('public Live production Account readiness mismatch');
        }
    }
    process.stdout.write(`Live production Account ${mode} preflight passed without exposing secrets.\n`);
}

main().catch((error) => {
    process.stderr.write(`Live production Account preflight failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
});
