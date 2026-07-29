import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/auth globally for this file since auth.ts re-exports from it
vi.mock('@/auth', () => ({
    auth: vi.fn().mockResolvedValue(null),
}));

import { isAdmin, isAdminOrProvider } from '../auth';

describe('isAdmin', () => {
    it('returns true for ADMIN', () => {
        expect(isAdmin('ADMIN')).toBe(true);
    });

    it('returns false for PROVIDER', () => {
        expect(isAdmin('PROVIDER')).toBe(false);
    });

    it('returns false for USER', () => {
        expect(isAdmin('USER')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAdmin('')).toBe(false);
    });
});

describe('isAdminOrProvider', () => {
    it('returns true for ADMIN', () => {
        expect(isAdminOrProvider('ADMIN')).toBe(true);
    });

    it('returns true for PROVIDER', () => {
        expect(isAdminOrProvider('PROVIDER')).toBe(true);
    });

    it('returns false for USER', () => {
        expect(isAdminOrProvider('USER')).toBe(false);
    });

    it('returns false for LISTENER', () => {
        expect(isAdminOrProvider('LISTENER')).toBe(false);
    });
});

describe('requireAuth', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns [session, null] when authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'user-123', email: 'test@example.com', name: 'Test', image: null, role: 'USER' },
            }),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).not.toBeNull();
        expect(session!.user.id).toBe('user-123');
        expect(error).toBeNull();
    });

    it('returns [null, 401] when session is null', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).toBeNull();
        expect(error).not.toBeNull();
        expect(error!.status).toBe(401);
    });

    it('returns [null, 401] when user.id is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({ user: { email: 'test@example.com' } }),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).toBeNull();
        expect(error!.status).toBe(401);
    });
});

describe('requireRole', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns [session, null] when role matches', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', image: null, role: 'ADMIN' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).not.toBeNull();
        expect(session!.user.role).toBe('ADMIN');
        expect(error).toBeNull();
    });

    it('returns [null, 403] when role does not match', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'user-1', email: 'user@example.com', name: 'User', image: null, role: 'USER' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).toBeNull();
        expect(error!.status).toBe(403);
    });

    it('returns [null, 401] when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).toBeNull();
        expect(error!.status).toBe(401);
    });

    it('accepts multiple roles', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'prov-1', email: 'prov@example.com', name: 'Provider', image: null, role: 'PROVIDER' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN', 'PROVIDER');
        expect(session).not.toBeNull();
        expect(error).toBeNull();
    });
});

/**
 * The weekend helpers. Unlike `requireAuth`/`requireRole` above — kept only for
 * the surfaces the strip removes — these are the live authorization boundary, so
 * they are exercised against the real resolver with a mocked database rather
 * than against a mocked principal.
 */

const ATTENDEE_COOKIE = 'attendee-cookie-value';

function mountRequest(webSessionRow: Record<string, unknown> | null, cookie = ATTENDEE_COOKIE) {
    const prisma = { webSession: { findUnique: vi.fn().mockResolvedValue(webSessionRow) } };
    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    vi.doMock('next/headers', () => ({
        cookies: vi.fn().mockResolvedValue({
            get: (name: string) => (name === 'hb_session' && cookie ? { value: cookie } : undefined),
        }),
    }));
    return prisma;
}

async function digestOf(token: string) {
    const { digestSessionToken } = await import('../session-auth');
    return digestSessionToken(token);
}

async function attendeeRow(entitlement: Record<string, unknown> = {}) {
    return {
        id: 'web-session-1',
        tokenDigest: await digestOf(ATTENDEE_COOKIE),
        expiresAt: new Date('2026-08-09T00:00:00.000Z'),
        revokedAt: null,
        staffUser: null,
        ticketEntitlement: {
            id: 'ticket-1',
            scheduledSessionId: 'session-saturday',
            tier: 'GLOBAL_SOUTH',
            codeLastFour: '4XZP',
            state: 'BOUND',
            expiresAt: new Date('2026-08-05T00:00:00.000Z'),
            revokedAt: null,
            ...entitlement,
        },
    };
}

async function staffRow(role: string, disabledAt: Date | null = null) {
    return {
        id: 'web-session-2',
        tokenDigest: await digestOf(ATTENDEE_COOKIE),
        expiresAt: new Date('2026-08-09T00:00:00.000Z'),
        revokedAt: null,
        staffUser: { id: 'user-1', role, disabledAt },
        ticketEntitlement: null,
    };
}

describe('requirePrincipal', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('denies a protected API request that arrives with no cookie', async () => {
        mountRequest(await attendeeRow(), '');
        const { requirePrincipal } = await import('../auth');

        const [principal, errorResponse] = await requirePrincipal();

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(401);
        expect(await errorResponse!.json()).toEqual({ error: 'Authentication required' });
    });

    it('resolves an attendee cookie into its ticket', async () => {
        mountRequest(await attendeeRow());
        const { requirePrincipal } = await import('../auth');

        const [principal, errorResponse] = await requirePrincipal();

        expect(errorResponse).toBeNull();
        expect(principal).toMatchObject({ kind: 'attendee', entitlementId: 'ticket-1' });
    });
});

describe('requireAttendee', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('admits a ticket holder', async () => {
        mountRequest(await attendeeRow());
        const { requireAttendee } = await import('../auth');

        const [principal, errorResponse] = await requireAttendee();

        expect(errorResponse).toBeNull();
        expect(principal!.scheduledSessionId).toBe('session-saturday');
    });

    it('refuses an already issued cookie once the entitlement is revoked', async () => {
        // The launch blocker in the roadmap: revoking a ticket has to invalidate
        // the cookie the holder already has, not just future logins.
        mountRequest(await attendeeRow({ state: 'REVOKED', revokedAt: new Date('2026-08-01T18:00:00.000Z') }));
        const { requireAttendee } = await import('../auth');

        const [principal, errorResponse] = await requireAttendee();

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(401);
    });

    it('refuses staff, who hold no entitlement', async () => {
        mountRequest(await staffRow('ADMIN'));
        const { requireAttendee } = await import('../auth');

        const [principal, errorResponse] = await requireAttendee();

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(403);
    });
});

describe('requireStaff', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('admits any staff member when no role is named', async () => {
        mountRequest(await staffRow('OPERATOR'));
        const { requireStaff } = await import('../auth');

        const [principal, errorResponse] = await requireStaff();

        expect(errorResponse).toBeNull();
        expect(principal).toMatchObject({ kind: 'staff', role: 'OPERATOR' });
    });

    it('admits a named role and refuses the others', async () => {
        mountRequest(await staffRow('OPERATOR'));
        const { requireStaff } = await import('../auth');

        expect((await requireStaff('OPERATOR', 'ADMIN'))[0]).not.toBeNull();

        const [principal, errorResponse] = await requireStaff('ADMIN');
        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(403);
        expect(await errorResponse!.json()).toEqual({ error: 'Insufficient permissions' });
    });

    it('refuses a disabled staff account still holding a cookie', async () => {
        mountRequest(await staffRow('ADMIN', new Date('2026-07-31T00:00:00.000Z')));
        const { requireStaff } = await import('../auth');

        const [principal, errorResponse] = await requireStaff('ADMIN');

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(401);
    });

    it('refuses an attendee reaching for an operator route', async () => {
        mountRequest(await attendeeRow());
        const { requireStaff } = await import('../auth');

        const [principal, errorResponse] = await requireStaff('FACILITATOR', 'OPERATOR', 'ADMIN');

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(403);
    });
});

describe('requireSessionAccess', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('admits the attendee whose ticket names the event', async () => {
        mountRequest(await attendeeRow());
        const { requireSessionAccess } = await import('../auth');

        const [principal, errorResponse] = await requireSessionAccess('session-saturday');

        expect(errorResponse).toBeNull();
        expect(principal).toMatchObject({ kind: 'attendee' });
    });

    it("refuses a Saturday ticket at Sunday's room", async () => {
        mountRequest(await attendeeRow());
        const { requireSessionAccess } = await import('../auth');

        const [principal, errorResponse] = await requireSessionAccess('session-sunday');

        expect(principal).toBeNull();
        expect(errorResponse!.status).toBe(403);
    });

    it('admits staff for any event they operate', async () => {
        mountRequest(await staffRow('FACILITATOR'));
        const { requireSessionAccess } = await import('../auth');

        const [principal, errorResponse] = await requireSessionAccess('session-sunday');

        expect(errorResponse).toBeNull();
        expect(principal).toMatchObject({ kind: 'staff' });
    });

    it('refuses a request with no cookie', async () => {
        mountRequest(await attendeeRow(), '');
        const { requireSessionAccess } = await import('../auth');

        expect((await requireSessionAccess('session-saturday'))[1]!.status).toBe(401);
    });
});
