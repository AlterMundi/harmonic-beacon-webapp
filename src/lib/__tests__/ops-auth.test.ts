import { describe, it, expect, vi, beforeEach } from 'vitest';

import { digestSessionToken } from '../session-auth';

/**
 * Staff session resolution for the /ops surface: an hb_session cookie only
 * resolves to a staff principal when the WebSession row is staff-owned,
 * unexpired, unrevoked, and the staff account is enabled.
 */

describe('resolveStaffByToken', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function mockDb(session: unknown) {
        const mockPrisma = {
            webSession: { findUnique: vi.fn().mockResolvedValue(session) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        return mockPrisma;
    }

    const staffRow = {
        id: 'staff-uuid-1',
        email: 'admin@harmonicbeacon.com',
        name: 'Admin',
        role: 'ADMIN',
        disabledAt: null,
    };

    function activeStaffSession(overrides: Record<string, unknown> = {}) {
        return {
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            staffUser: staffRow,
            ...overrides,
        };
    }

    it('resolves an active staff session to the staff principal', async () => {
        const mockPrisma = mockDb(activeStaffSession());

        const { resolveStaffByToken } = await import('../ops-auth');
        const principal = await resolveStaffByToken('cookie-token');

        expect(mockPrisma.webSession.findUnique).toHaveBeenCalledWith({
            where: { tokenDigest: digestSessionToken('cookie-token') },
            include: { staffUser: true },
        });
        expect(principal).toEqual({
            id: staffRow.id,
            email: staffRow.email,
            name: staffRow.name,
            role: 'ADMIN',
        });
    });

    it('returns null when no cookie token is present', async () => {
        mockDb(null);
        const { resolveStaffByToken } = await import('../ops-auth');
        expect(await resolveStaffByToken(undefined)).toBeNull();
    });

    it('returns null for an attendee session (no staff user attached)', async () => {
        mockDb(activeStaffSession({ staffUser: null }));
        const { resolveStaffByToken } = await import('../ops-auth');
        expect(await resolveStaffByToken('cookie-token')).toBeNull();
    });

    it('returns null for a revoked session', async () => {
        mockDb(activeStaffSession({ revokedAt: new Date() }));
        const { resolveStaffByToken } = await import('../ops-auth');
        expect(await resolveStaffByToken('cookie-token')).toBeNull();
    });

    it('returns null for an expired session', async () => {
        mockDb(activeStaffSession({ expiresAt: new Date(Date.now() - 1000) }));
        const { resolveStaffByToken } = await import('../ops-auth');
        expect(await resolveStaffByToken('cookie-token')).toBeNull();
    });

    it('returns null for a disabled staff account', async () => {
        mockDb(activeStaffSession({ staffUser: { ...staffRow, disabledAt: new Date() } }));
        const { resolveStaffByToken } = await import('../ops-auth');
        expect(await resolveStaffByToken('cookie-token')).toBeNull();
    });
});
