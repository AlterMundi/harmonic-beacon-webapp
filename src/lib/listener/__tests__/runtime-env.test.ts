import { describe, expect, it } from 'vitest';

import {
    ListenerRuntimeEnvironmentError,
    listenerRuntimeBundle,
    listenerRuntimeFlag,
    listenerRuntimeValue,
    listenerAppleOAuthConfiguration,
    validateListenerAppleClientSecret,
    validateListenerRuntimeEnvironment,
} from '../runtime-env';

function appleClientSecret(
    clientId: string,
    overrides: Record<string, unknown> = {},
): string {
    return [
        Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'KEY123' })).toString('base64url'),
        Buffer.from(JSON.stringify({
            iss: 'TEAM123',
            sub: clientId,
            aud: 'https://appleid.apple.com',
            iat: 1_799_999_900,
            exp: 1_800_003_600,
            ...overrides,
        })).toString('base64url'),
        'synthetic-signature',
    ].join('.');
}

describe('Listener runtime environment compatibility', () => {
    it('reads canonical-only, legacy-only and matching dual values', () => {
        expect(listenerRuntimeValue('ENABLED', { BEACON_LISTENER_ENABLED: ' 1 ' })).toBe('1');
        expect(listenerRuntimeValue('ENABLED', { EARLY_BIRDS_ENABLED: '1' })).toBe('1');
        expect(listenerRuntimeValue('ENABLED', {
            BEACON_LISTENER_ENABLED: '1',
            EARLY_BIRDS_ENABLED: ' 1 ',
        })).toBe('1');
        expect(listenerRuntimeValue('ENABLED', {
            BEACON_LISTENER_ENABLED: '   ',
            EARLY_BIRDS_ENABLED: '',
        })).toBeUndefined();
    });

    it('keeps feature gates exact even though ordinary values are trimmed', () => {
        expect(listenerRuntimeFlag('ENABLED', { BEACON_LISTENER_ENABLED: '1' })).toBe(true);
        expect(listenerRuntimeFlag('ENABLED', { BEACON_LISTENER_ENABLED: ' 1 ' })).toBe(false);
        expect(listenerRuntimeFlag('ENABLED', { EARLY_BIRDS_ENABLED: '1' })).toBe(true);
        expect(listenerRuntimeFlag('ENABLED', { EARLY_BIRDS_ENABLED: 'true' })).toBe(false);
    });

    it('fails closed on conflicting generations without including values', () => {
        const canonicalSecret = 'canonical-secret-value';
        const legacySecret = 'legacy-secret-value';
        expect(() => listenerRuntimeValue('AUTH_SECRET', {
            BEACON_LISTENER_AUTH_SECRET: canonicalSecret,
            EARLY_BIRDS_AUTH_SECRET: legacySecret,
        })).toThrow(ListenerRuntimeEnvironmentError);
        try {
            listenerRuntimeValue('AUTH_SECRET', {
                BEACON_LISTENER_AUTH_SECRET: canonicalSecret,
                EARLY_BIRDS_AUTH_SECRET: legacySecret,
            });
        } catch (error) {
            expect(String(error)).toContain('BEACON_LISTENER_AUTH_SECRET');
            expect(String(error)).toContain('EARLY_BIRDS_AUTH_SECRET');
            expect(String(error)).not.toContain(canonicalSecret);
            expect(String(error)).not.toContain(legacySecret);
        }
    });

    it('keeps OAuth pairs within one complete generation', () => {
        expect(listenerRuntimeBundle(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
            BEACON_LISTENER_GOOGLE_CLIENT_ID: 'id',
            BEACON_LISTENER_GOOGLE_CLIENT_SECRET: 'secret',
        })).toEqual({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
        expect(listenerRuntimeBundle(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
            EARLY_BIRDS_GOOGLE_CLIENT_ID: 'old-id',
            EARLY_BIRDS_GOOGLE_CLIENT_SECRET: 'old-secret',
        })).toEqual({ GOOGLE_CLIENT_ID: 'old-id', GOOGLE_CLIENT_SECRET: 'old-secret' });
        expect(() => listenerRuntimeBundle(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
            BEACON_LISTENER_GOOGLE_CLIENT_ID: 'new-id',
            EARLY_BIRDS_GOOGLE_CLIENT_SECRET: 'old-secret',
        })).toThrow(/Incomplete Listener runtime bundle/);
    });

    it('accepts matching dual bundles and rejects a mismatched member', () => {
        const matching = {
            BEACON_LISTENER_MAGIC_LINK_DELIVERY_URL: 'https://mail.example.test/deliver',
            BEACON_LISTENER_MAGIC_LINK_DELIVERY_TOKEN: 'token',
            BEACON_LISTENER_MAGIC_LINK_RATE_SECRET: 'rate',
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL: 'https://mail.example.test/deliver',
            EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN: 'token',
            EARLY_BIRDS_MAGIC_LINK_RATE_SECRET: 'rate',
        };
        expect(listenerRuntimeBundle([
            'MAGIC_LINK_DELIVERY_URL',
            'MAGIC_LINK_DELIVERY_TOKEN',
            'MAGIC_LINK_RATE_SECRET',
        ], matching)).toEqual({
            MAGIC_LINK_DELIVERY_URL: 'https://mail.example.test/deliver',
            MAGIC_LINK_DELIVERY_TOKEN: 'token',
            MAGIC_LINK_RATE_SECRET: 'rate',
        });
        expect(() => listenerRuntimeBundle([
            'MAGIC_LINK_DELIVERY_URL',
            'MAGIC_LINK_DELIVERY_TOKEN',
            'MAGIC_LINK_RATE_SECRET',
        ], {
            ...matching,
            EARLY_BIRDS_MAGIC_LINK_RATE_SECRET: 'different-rate',
        })).toThrow(/BEACON_LISTENER_MAGIC_LINK_RATE_SECRET, EARLY_BIRDS_MAGIC_LINK_RATE_SECRET/);
    });

    it('validates the deployed legacy shape and catches a dead dual-env rollout', () => {
        const legacy = {
            EARLY_BIRDS_ENABLED: '1',
            EARLY_BIRDS_FREE_FOR_ALL: '0',
            EARLY_BIRDS_AUTH_BASE_URL: 'https://listen.example.test',
            EARLY_BIRDS_TRUSTED_ORIGINS: 'https://listen.example.test',
            EARLY_BIRDS_AUTH_SECRET: 'a'.repeat(32),
            EARLY_BIRDS_GOOGLE_CLIENT_ID: 'google-id',
            EARLY_BIRDS_GOOGLE_CLIENT_SECRET: 'google-secret',
            EARLY_BIRDS_TEST_ACCESS_ENABLED: '0',
            EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: '0',
        };
        expect(validateListenerRuntimeEnvironment(legacy)).toBe(true);
        expect(validateListenerRuntimeEnvironment({})).toBe(false);
        expect(() => validateListenerRuntimeEnvironment({
            ...legacy,
            BEACON_LISTENER_AUTH_BASE_URL: 'https://different.example.test',
        })).toThrow(/BEACON_LISTENER_AUTH_BASE_URL, EARLY_BIRDS_AUTH_BASE_URL/);
    });

    it('rejects ambiguous flags and incomplete enabled credential bundles', () => {
        expect(() => validateListenerRuntimeEnvironment({
            BEACON_LISTENER_ENABLED: ' 1 ',
            BEACON_LISTENER_AUTH_BASE_URL: 'https://listen.example.test',
            BEACON_LISTENER_AUTH_SECRET: 'a'.repeat(32),
        })).toThrow(/Invalid Listener runtime flag/);
        expect(() => validateListenerRuntimeEnvironment({
            BEACON_LISTENER_ENABLED: '1',
            BEACON_LISTENER_AUTH_BASE_URL: 'https://listen.example.test',
        })).toThrow(/Enabled Listener requires/);
        expect(() => validateListenerRuntimeEnvironment({
            BEACON_LISTENER_ENABLED: '0',
            BEACON_LISTENER_GOOGLE_CLIENT_ID: 'id-only',
        })).toThrow(/Incomplete Listener runtime bundle/);
    });

    it('exposes Apple only behind a valid explicit same-generation gate', () => {
        const clientId = 'com.harmonicbeacon.listener';
        const secret = appleClientSecret(clientId);
        const enabled = {
            BEACON_LISTENER_ENABLED: '1',
            BEACON_LISTENER_AUTH_BASE_URL: 'https://listen.example.test',
            BEACON_LISTENER_AUTH_SECRET: 'a'.repeat(32),
            BEACON_LISTENER_APPLE_ENABLED: '1',
            BEACON_LISTENER_APPLE_CLIENT_ID: clientId,
            BEACON_LISTENER_APPLE_CLIENT_SECRET: secret,
        };
        expect(validateListenerAppleClientSecret(clientId, secret, 1_800_000_000)).toBe(true);
        expect(listenerAppleOAuthConfiguration(enabled, 1_800_000_000)).toEqual({
            clientId,
            clientSecret: secret,
        });

        expect(listenerAppleOAuthConfiguration({
            ...enabled,
            BEACON_LISTENER_APPLE_ENABLED: '0',
        }, 1_800_000_000)).toBeNull();
        expect(() => listenerAppleOAuthConfiguration({
            ...enabled,
            BEACON_LISTENER_APPLE_CLIENT_SECRET: appleClientSecret('other-client'),
        }, 1_800_000_000)).toThrow(/Invalid Listener Apple OAuth configuration/);
        expect(() => listenerAppleOAuthConfiguration({
            BEACON_LISTENER_APPLE_ENABLED: '1',
            EARLY_BIRDS_APPLE_CLIENT_ID: clientId,
            EARLY_BIRDS_APPLE_CLIENT_SECRET: secret,
        }, 1_800_000_000)).toThrow(/Unsupported legacy Listener Apple OAuth variables/);
    });

    it('rejects stale, overlong and wrongly-scoped Apple client-secret JWTs', () => {
        const clientId = 'com.harmonicbeacon.listener';
        expect(validateListenerAppleClientSecret(
            clientId,
            appleClientSecret(clientId, { exp: 1_799_999_999 }),
            1_800_000_000,
        )).toBe(false);
        expect(validateListenerAppleClientSecret(
            clientId,
            appleClientSecret(clientId, { exp: 1_900_000_000 }),
            1_800_000_000,
        )).toBe(false);
        expect(validateListenerAppleClientSecret(
            clientId,
            appleClientSecret(clientId, { aud: 'https://attacker.invalid' }),
            1_800_000_000,
        )).toBe(false);
        expect(validateListenerAppleClientSecret(clientId, 'not-a-jwt', 1_800_000_000))
            .toBe(false);
    });

    it('fails readiness when enabled Apple OAuth is not HTTPS', () => {
        const clientId = 'com.harmonicbeacon.listener';
        const now = Math.floor(Date.now() / 1000);
        expect(() => validateListenerRuntimeEnvironment({
            BEACON_LISTENER_ENABLED: '1',
            BEACON_LISTENER_AUTH_BASE_URL: 'http://listen.example.test',
            BEACON_LISTENER_AUTH_SECRET: 'a'.repeat(32),
            BEACON_LISTENER_APPLE_ENABLED: '1',
            BEACON_LISTENER_APPLE_CLIENT_ID: clientId,
            BEACON_LISTENER_APPLE_CLIENT_SECRET: appleClientSecret(clientId, {
                iat: now - 10,
                exp: now + 3600,
            }),
        })).toThrow(/requires an HTTPS/);
    });
});
