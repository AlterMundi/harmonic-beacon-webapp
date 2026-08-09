import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_COOKIE_NAME, digestSessionToken } from '../session-auth';

/**
 * The authorization boundary.
 *
 * Section 1 of the weekend roadmap: "Every request resolves the session against
 * the database and the current ticket status. Revoking a ticket therefore
 * invalidates an existing cookie as well as new logins." These tests are that
 * sentence — each denial below is a cookie that is intact, correctly signed by
 * nothing, and still refused because the database says so.
 */

const TOKEN = 'opaque-cookie-value-for-tests';
const NOW = new Date('2026-08-01T18:00:00.000Z');
const LATER = new Date('2026-08-01T19:00:00.000Z');

type WebSessionRow = Record<string, unknown> | null;

function withWebSession(row: WebSessionRow) {
    const findUnique = vi.fn().mockResolvedValue(row);
    const updateMany = vi.fn().mockResolvedValue({ count: row ? 1 : 0 });
    const prisma = { webSession: { findUnique, updateMany } };
    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    return { findUnique, updateMany };
}

function withCookie(value: string | undefined) {
    vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
            get: (name: string) => (name === SESSION_COOKIE_NAME && value ? { value } : undefined),
        }),
    }));
}

/** A live staff session: valid row, enabled user. */
function staffSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'web-session-staff',
        tokenDigest: digestSessionToken(TOKEN),
        expiresAt: new Date('2036-08-09T00:00:00.000Z'),
        revokedAt: null,
        staffUser: { id: 'user-facilitator', role: 'FACILITATOR', disabledAt: null },
        ticketEntitlement: null,
        ...overrides,
    };
}

/** A live attendee session: bound ticket, not revoked, not expired. */
function attendeeSession(entitlement: Record<string, unknown> = {}) {
    return {
        id: 'web-session-attendee',
        tokenDigest: digestSessionToken(TOKEN),
        expiresAt: new Date('2036-08-09T00:00:00.000Z'),
        revokedAt: null,
        staffUser: null,
        ticketEntitlement: {
            id: 'ticket-1',
            scheduledSessionId: 'session-saturday',
            tier: 'GLOBAL_NORTH',
            codeLastFour: '4XZP',
            state: 'BOUND',
            expiresAt: new Date('2026-08-05T00:00:00.000Z'),
            revokedAt: null,
            ...entitlement,
        },
    };
}

async function importPrincipal() {
    return import('../principal');
}

describe('principalFromToken', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
        vi.doUnmock('next/headers');
    });

    it('resolves an attendee from their bound ticket without touching their email', async () => {
        const { findUnique } = withWebSession(attendeeSession());
        const { principalFromToken } = await importPrincipal();

        const principal = await principalFromToken(TOKEN, NOW);

        expect(principal).toEqual({
            kind: 'attendee',
            webSessionId: 'web-session-attendee',
            entitlementId: 'ticket-1',
            scheduledSessionId: 'session-saturday',
            tier: 'GLOBAL_NORTH',
            codeLastFour: '4XZP',
        });
        // A principal that never carries an email cannot leak one into a LiveKit
        // identity, a tapestry key, or a log line downstream.
        expect(JSON.stringify(principal)).not.toContain('@');

        // Looked up by digest: the plaintext cookie value is never a query value.
        const where = findUnique.mock.calls[0][0].where;
        expect(where.tokenDigest).toBe(digestSessionToken(TOKEN));
        expect(JSON.stringify(findUnique.mock.calls[0][0])).not.toContain(TOKEN);
    });

    it('resolves staff with their current role', async () => {
        withWebSession(staffSession());
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, NOW)).toEqual({
            kind: 'staff',
            webSessionId: 'web-session-staff',
            userId: 'user-facilitator',
            role: 'FACILITATOR',
        });
    });

    it('denies a request with no cookie without querying the database', async () => {
        const { findUnique } = withWebSession(null);
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(undefined, NOW)).toBeNull();
        expect(await principalFromToken('', NOW)).toBeNull();
        expect(findUnique).not.toHaveBeenCalled();
    });

    it('denies an unknown token', async () => {
        withWebSession(null);
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, NOW)).toBeNull();
    });

    it('denies a token whose digest does not match the stored row', async () => {
        // Belt and braces for the day someone replaces the indexed equality
        // lookup with something looser.
        withWebSession({ ...attendeeSession(), tokenDigest: digestSessionToken('a different token') });
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, NOW)).toBeNull();
    });

    it('denies an expired session', async () => {
        withWebSession(attendeeSession());
        const { principalFromToken } = await importPrincipal();
        expect(await principalFromToken(TOKEN, NOW)).not.toBeNull();

        vi.resetModules();
        withWebSession({ ...attendeeSession(), expiresAt: NOW });
        const reloaded = await importPrincipal();
        expect(await reloaded.principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies a revoked session', async () => {
        withWebSession({ ...attendeeSession(), revokedAt: NOW });
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies a disabled staff account holding a live cookie', async () => {
        withWebSession(staffSession({
            staffUser: { id: 'user-operator', role: 'OPERATOR', disabledAt: NOW },
        }));
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies an already issued cookie once the entitlement is revoked', async () => {
        // The launch-blocking case: the cookie is untouched and unexpired, and
        // the operator has just revoked the ticket.
        withWebSession(attendeeSession({ state: 'REVOKED', revokedAt: NOW }));
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies a revoked entitlement even if its state column was not updated', async () => {
        withWebSession(attendeeSession({ revokedAt: NOW }));
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies an expired entitlement', async () => {
        withWebSession(attendeeSession({ expiresAt: NOW }));
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, LATER)).toBeNull();
    });

    it('denies a session pointing at a ticket that was never redeemed', async () => {
        withWebSession(attendeeSession({ state: 'ISSUED' }));
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, NOW)).toBeNull();
    });

    it('denies a session bound to neither staff nor a ticket', async () => {
        withWebSession({ ...attendeeSession(), staffUser: null, ticketEntitlement: null });
        const { principalFromToken } = await importPrincipal();

        expect(await principalFromToken(TOKEN, NOW)).toBeNull();
    });
});

describe('currentPrincipal', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
        vi.doUnmock('next/headers');
    });

    it('reads the hb_session cookie of the current request', async () => {
        withWebSession(attendeeSession());
        withCookie(TOKEN);
        const { currentPrincipal } = await importPrincipal();

        expect(await currentPrincipal(NOW)).toMatchObject({ kind: 'attendee' });
    });

    it('returns null when the request carries no session cookie', async () => {
        const { findUnique } = withWebSession(attendeeSession());
        withCookie(undefined);
        const { currentPrincipal } = await importPrincipal();

        expect(await currentPrincipal(NOW)).toBeNull();
        expect(findUnique).not.toHaveBeenCalled();
    });
});

describe('revokeWebSessionByToken', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
    });

    it('revokes the row matching the token digest and only if still live', async () => {
        const { updateMany } = withWebSession(attendeeSession());
        const { revokeWebSessionByToken } = await importPrincipal();

        await revokeWebSessionByToken(TOKEN, 'logout', NOW);

        expect(updateMany).toHaveBeenCalledWith({
            where: { tokenDigest: digestSessionToken(TOKEN), revokedAt: null },
            data: { revokedAt: NOW, revocationReason: 'logout' },
        });
    });

    it('does nothing when there is no cookie to revoke', async () => {
        const { updateMany } = withWebSession(null);
        const { revokeWebSessionByToken } = await importPrincipal();

        await revokeWebSessionByToken(undefined);

        expect(updateMany).not.toHaveBeenCalled();
    });
});

describe('normalizeLoginEmail', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('applies the identity contract: trim then lowercase', async () => {
        withWebSession(null);
        const { normalizeLoginEmail } = await importPrincipal();

        expect(normalizeLoginEmail('  Ana@Example.COM ')).toBe('ana@example.com');
        expect(normalizeLoginEmail('ana@example.com')).toBe('ana@example.com');
    });
});

describe('isPlausibleEmail', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('accepts real-world addresses and rejects unusable input', async () => {
        withWebSession(null);
        const { isPlausibleEmail } = await importPrincipal();

        expect(isPlausibleEmail('ana@example.com')).toBe(true);
        expect(isPlausibleEmail('ana+weekend@sub.example.com.ar')).toBe(true);

        expect(isPlausibleEmail('')).toBe(false);
        expect(isPlausibleEmail('ana')).toBe(false);
        expect(isPlausibleEmail('ana@localhost')).toBe(false);
        expect(isPlausibleEmail('@example.com')).toBe(false);
        expect(isPlausibleEmail('ana@@example.com')).toBe(false);
        expect(isPlausibleEmail('ana example@example.com')).toBe(false);
        expect(isPlausibleEmail('ana@example.')).toBe(false);
        expect(isPlausibleEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
    });
});

describe('session cookies', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('issues the secure weekend cookie and clears it with matching attributes', async () => {
        withWebSession(null);
        const { sessionCookie, clearedSessionCookie } = await importPrincipal();

        expect(sessionCookie('opaque-value', NOW)).toMatchObject({
            name: SESSION_COOKIE_NAME,
            value: 'opaque-value',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });

        const cleared = clearedSessionCookie();
        expect(cleared).toMatchObject({
            name: SESSION_COOKIE_NAME,
            value: '',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
        });
    });
});
