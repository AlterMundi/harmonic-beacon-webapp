import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SESSION_COOKIE_TTL_SECONDS,
    constantTimeDigestEqual,
    digestSessionToken,
    issueSessionToken,
    sessionCookieOptions,
    sessionTokenMatchesDigest,
    verifyStaffPassword,
    hashAccountPassword,
    verifyAccountPassword,
} from '../session-auth';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    accountPasswordLengthValid,
} from '@/lib/account/password-policy';

describe('opaque web sessions', () => {
    it('returns plaintext only for the cookie and a one-way digest for persistence', () => {
        const issued = issueSessionToken();

        expect(issued.cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(issued.database).toEqual({
            tokenDigest: digestSessionToken(issued.cookieValue),
        });
        expect(JSON.stringify(issued.database)).not.toContain(issued.cookieValue);
        expect(issued.database.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('compares valid digests and safely rejects malformed lengths', () => {
        const token = 'opaque-session-token';
        const digest = digestSessionToken(token);

        expect(sessionTokenMatchesDigest(token, digest)).toBe(true);
        expect(sessionTokenMatchesDigest(`${token}-wrong`, digest)).toBe(false);
        expect(constantTimeDigestEqual(digest, 'abcd')).toBe(false);
    });

    it('defines the secure weekend cookie contract', () => {
        const now = new Date('2026-07-28T12:00:00.000Z');
        const options = sessionCookieOptions(now);

        expect(options).toMatchObject({
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: DEFAULT_SESSION_COOKIE_TTL_SECONDS,
        });
        expect(options.expires.toISOString()).toBe('2026-08-04T12:00:00.000Z');
    });

    it('verifies the environment-supplied scrypt credential format', async () => {
        const salt = Buffer.alloc(16, 7);
        const digest = scryptSync('strong test password', salt, 32);
        const encoded = `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;

        await expect(verifyStaffPassword('strong test password', encoded)).resolves.toBe(true);
        await expect(verifyStaffPassword('wrong password', encoded)).resolves.toBe(false);
        await expect(verifyStaffPassword('strong test password', 'malformed')).resolves.toBe(false);
    });
});

describe('Account password policy', () => {
    it('accepts every composition at 8–128 characters and rejects only length boundaries', () => {
        expect(ACCOUNT_PASSWORD_MIN_LENGTH).toBe(8);
        expect(ACCOUNT_PASSWORD_MAX_LENGTH).toBe(128);
        expect(accountPasswordLengthValid('12345678')).toBe(true);
        expect(accountPasswordLengthValid('        ')).toBe(true);
        expect(accountPasswordLengthValid('a'.repeat(128))).toBe(true);
        expect(accountPasswordLengthValid('1234567')).toBe(false);
        expect(accountPasswordLengthValid('a'.repeat(129))).toBe(false);
    });

    it('keeps the versioned scrypt credential interoperable at the new minimum', async () => {
        const password = '12345678';
        const digest = await hashAccountPassword(password);
        expect(digest).toMatch(/^scrypt-v1\$/);
        await expect(verifyAccountPassword({ hash: digest, password })).resolves.toBe(true);
        await expect(verifyAccountPassword({ hash: digest, password: '1234567' })).resolves.toBe(false);
        await expect(hashAccountPassword('1234567')).rejects.toThrow('outside the accepted range');
        await expect(hashAccountPassword('a'.repeat(129))).rejects.toThrow('outside the accepted range');
    });
});
