import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    accountSocialProviderConfiguration,
    accountTokenPrefixes,
    ACCOUNT_SESSION_COOKIE,
} from '@/lib/account/config';
import { hashAccountClientSecret } from '@/lib/account/client-secret';

describe('Account OAuth client secret contract', () => {
    it('uses an explicit host-only Account browser session cookie name', () => {
        expect(ACCOUNT_SESSION_COOKIE).toBe('__Host-hb_account_session');
    });
    it('does not advertise or strip a client-secret prefix', () => {
        const prefixes = accountTokenPrefixes({
            BEACON_ACCOUNT_BASE_URL: 'https://account.harmonicbeacon.com',
        });
        expect(prefixes).toEqual({
            opaqueAccessToken: 'hb_acct_p_at_',
            refreshToken: 'hb_acct_p_rt_',
        });
        expect('clientSecret' in prefixes).toBe(false);
    });

    it('hashes the complete presented secret exactly once with SHA-256/base64url', () => {
        const secret = 'hb_acct_p_cs_complete-secret-that-must-not-be-stripped';
        expect(hashAccountClientSecret(secret)).toBe(
            createHash('sha256').update(secret, 'utf8').digest('base64url'),
        );
        expect(hashAccountClientSecret(secret)).not.toBe(
            createHash('sha256').update(secret.replace('hb_acct_p_cs_', ''), 'utf8')
                .digest('base64url'),
        );
    });
});

describe('Account social-provider readiness contract', () => {
    const base = { BEACON_ACCOUNT_BASE_URL: 'https://account.harmonicbeacon.com' };
    it('rejects an enabled malformed Google configuration', () => {
        expect(() => accountSocialProviderConfiguration({
            ...base,
            BEACON_ACCOUNT_GOOGLE_ENABLED: '1',
            BEACON_ACCOUNT_GOOGLE_CLIENT_ID: 'not-google',
            BEACON_ACCOUNT_GOOGLE_CLIENT_SECRET: 'long-enough-but-invalid-secret',
        })).toThrow(/Google OAuth client ID/);
    });

    it('rejects expired and malformed Apple client-secret JWTs', () => {
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const clientId = 'com.harmonicbeacon.account';
        const expired = `${encode({ alg: 'ES256', kid: 'KEY123' })}.${encode({
            iss: 'TEAM123', sub: clientId, aud: 'https://appleid.apple.com',
            iat: 1, exp: 2,
        })}.signature-long-enough`;
        for (const secret of ['not-a-jwt-but-long-enough', expired]) {
            expect(() => accountSocialProviderConfiguration({
                ...base,
                BEACON_ACCOUNT_APPLE_ENABLED: '1',
                BEACON_ACCOUNT_APPLE_CLIENT_ID: clientId,
                BEACON_ACCOUNT_APPLE_CLIENT_SECRET: secret,
            })).toThrow(/Apple client-secret JWT/);
        }
    });
});
