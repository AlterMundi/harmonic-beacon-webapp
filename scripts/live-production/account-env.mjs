#!/usr/bin/env node

export const AUTHORITY_ENV = '/etc/harmonic-beacon/account.production.env';
export const TARGET_DIRECTORY = '/etc/harmonic-beacon/live-production-secrets';
export const TARGET_ENV = `${TARGET_DIRECTORY}/account.env`;
export const ISSUER = 'https://account.harmonicbeacon.com';
export const CLIENT_ID = 'hb-live';
export const AUTHORITY_KEY = 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE';
export const TARGET_KEYS = [
    'BEACON_ACCOUNT_ENABLED',
    'BEACON_ACCOUNT_ISSUER_URL',
    'BEACON_ACCOUNT_CLIENT_ID',
    'BEACON_ACCOUNT_CLIENT_SECRET',
];

function fail(message) {
    throw new Error(message);
}

export function parseEnv(contents) {
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

function secret(value, name) {
    if (typeof value !== 'string' || value.length < 32 || /[\r\n\0]/.test(value)) {
        fail(`${name} is invalid`);
    }
    return value;
}

export function validateTarget(values) {
    if ([...values.keys()].join('\n') !== TARGET_KEYS.join('\n')) {
        fail('Live production Account bundle keys or ordering are invalid');
    }
    if (values.get('BEACON_ACCOUNT_ENABLED') !== 'true') fail('Account bundle must enable Account');
    if (values.get('BEACON_ACCOUNT_ISSUER_URL') !== ISSUER) fail('Account issuer is not production');
    if (values.get('BEACON_ACCOUNT_CLIENT_ID') !== CLIENT_ID) fail('Account client ID is not hb-live');
    secret(values.get('BEACON_ACCOUNT_CLIENT_SECRET'), 'Account client secret');
    return values;
}

export function buildTarget(authority) {
    if (authority.get('BEACON_ACCOUNT_BASE_URL') !== ISSUER ||
        authority.get('BEACON_ACCOUNT_RUNTIME') !== '1') {
        fail('Account production authority is not exact and enabled');
    }
    const clientSecret = secret(authority.get(AUTHORITY_KEY), 'Authority hb-live client secret');
    if (authority.get('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING')) {
        fail('Account production authority must not carry the staging Live client secret');
    }
    const values = new Map([
        ['BEACON_ACCOUNT_ENABLED', 'true'],
        ['BEACON_ACCOUNT_ISSUER_URL', ISSUER],
        ['BEACON_ACCOUNT_CLIENT_ID', CLIENT_ID],
        ['BEACON_ACCOUNT_CLIENT_SECRET', clientSecret],
    ]);
    validateTarget(values);
    return `${[...values].map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}
