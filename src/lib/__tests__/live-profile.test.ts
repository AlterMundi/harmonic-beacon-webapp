import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: vi.fn(), principal: vi.fn(), enabled: vi.fn(), user: vi.fn(), binding: vi.fn(), presence: vi.fn(), events: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/principal', () => ({ currentAccountIdentity: m.account, currentPrincipal: m.principal }));
vi.mock('@/lib/account-rp', () => ({ beaconAccountEnabled: m.enabled }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: m.user }, staffAccountBinding: { findUnique: m.binding }, livePresenceInterval: { findMany: m.presence }, scheduledSession: { findMany: m.events }, webSession: { findUnique: m.session } } }));
import { resolveLiveProfile } from '../live-profile';

beforeEach(() => {
    vi.resetAllMocks(); m.enabled.mockReturnValue(true); m.principal.mockResolvedValue(null);
    m.account.mockResolvedValue({ issuer: 'https://account.harmonicbeacon.com', subject: 'own-account', displayName: 'Sai' });
    m.binding.mockResolvedValue(null); m.presence.mockResolvedValue([]); m.events.mockResolvedValue([]);
});
describe('private Live profile', () => {
    it('does not return data or query hours for an unauthenticated visitor', async () => {
        m.account.mockResolvedValue(null);
        expect(await resolveLiveProfile()).toBeNull(); expect(m.presence).not.toHaveBeenCalled();
    });
    it('uses the exact issuer/subject rather than an email or browser role', async () => {
        const result = await resolveLiveProfile();
        expect(result?.role).toBeNull();
        expect(m.presence).toHaveBeenCalledWith(expect.objectContaining({ where: {
            participant: { OR: [{ ticketEntitlement: { accountIssuer: 'https://account.harmonicbeacon.com', accountId: 'own-account' } }] },
            scheduledSession: { isTest: false },
        } }));
        expect(result?.identityKey).toMatch(/^[a-f0-9]{64}$/);
    });
    it('does not treat a disabled binding or disabled staff member as staff', async () => {
        m.binding.mockResolvedValue({ disabledAt: new Date(), staffUser: { id: 'staff', role: 'ADMIN', disabledAt: null } });
        expect((await resolveLiveProfile())?.role).toBeNull();
        m.binding.mockResolvedValue({ disabledAt: null, staffUser: { id: 'staff', role: 'ADMIN', disabledAt: new Date() } });
        expect((await resolveLiveProfile())?.role).toBeNull();
    });
    it('reads a legacy attendee name only from their authenticated session', async () => {
        m.account.mockResolvedValue(null);
        m.principal.mockResolvedValue({ kind: 'attendee', webSessionId: 'own-session', entitlementId: 'own-ticket' });
        m.session.mockResolvedValue({ displayName: 'Ana' });
        const result = await resolveLiveProfile();
        expect(result?.name).toBe('Ana'); expect(result?.role).toBeNull();
        expect(m.session).toHaveBeenCalledWith({ where: { id: 'own-session' }, select: { displayName: true } });
    });
    it('keeps failed hours unknown and preserves independently available events', async () => {
        m.presence.mockRejectedValue(new Error('Database unavailable'));
        m.events.mockResolvedValue([{ id: 'event' }]);
        const result = await resolveLiveProfile(); expect(result?.seconds).toBeNull(); expect(result?.events).toEqual([{ id: 'event' }]);
    });
});
