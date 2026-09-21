import { beforeEach, describe, expect, it, vi } from 'vitest';
const { find } = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { livePresenceInterval: { findFirst: find } } }));
import { liveProfileEntryAllowed } from '@/lib/live-profile-entry';

describe('profile completion at new Live entry', () => {
    beforeEach(() => { vi.resetAllMocks(); find.mockResolvedValue(null); });
    it('allows complete profiles without querying presence', async () => {
        expect(await liveProfileEntryAllowed({ complete: true, scheduledSessionId: 'event' })).toBe(true);
        expect(find).not.toHaveBeenCalled();
    });
    it('requires completion for new or historical incomplete accounts', async () => {
        for (const complete of [null, undefined, false]) {
            expect(await liveProfileEntryAllowed({ complete, scheduledSessionId: 'event' })).toBe(false);
        }
        expect(find).not.toHaveBeenCalled();
        expect(await liveProfileEntryAllowed({ complete: null, scheduledSessionId: 'event', ticketEntitlementId: 'ticket' })).toBe(false);
    });
    it('preserves only active presence for this exact entitlement and event', async () => {
        find.mockResolvedValue({ id: 'active-interval' });
        const now = new Date('2026-09-21T17:00:00Z');
        expect(await liveProfileEntryAllowed({ complete: false, scheduledSessionId: 'event', ticketEntitlementId: 'ticket', now })).toBe(true);
        expect(find).toHaveBeenCalledWith({ where: {
            scheduledSessionId: 'event', endedAt: null,
            lastHeartbeatAt: { gte: new Date('2026-09-21T16:59:15Z'), lte: now },
            participant: { ticketEntitlementId: 'ticket', leftAt: null },
        }, select: { id: true } });
    });
});
