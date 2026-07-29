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
} from '../session-auth';

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
