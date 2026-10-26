import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ subject: vi.fn(), membership: vi.fn(), intervals: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { listenerAccountSubject: { findUnique: m.subject }, earlyBirdMembershipProjection: { findUnique: m.membership }, earlyBirdListeningInterval: { findMany: m.intervals } } }));
import { listenerProfileSummary, listeningSeconds, profileIdentityKey } from '../profile-summary';
const issuer = 'https://account.harmonicbeacon.com';
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 10, minutes));
beforeEach(() => { vi.resetAllMocks(); m.subject.mockResolvedValue({ issuer, subject: 'own-subject' }); m.membership.mockResolvedValue(null); m.intervals.mockResolvedValue([]); });
describe('Listener private profile summary', () => {
    it('unions two devices and clips stale closed records', () => {
        expect(listeningSeconds([
            { startedAt: at(0), lastHeartbeatAt: at(5), endedAt: at(30) },
            { startedAt: at(2), lastHeartbeatAt: at(5), endedAt: null },
        ], at(30))).toBe(345);
    });
    it('refuses a subject from the other environment before reading membership', async () => {
        m.subject.mockResolvedValue({ issuer: 'https://account-staging.harmonicbeacon.com', subject: 'own-subject' });
        expect(await listenerProfileSummary('own-account', issuer)).toBeNull(); expect(m.membership).not.toHaveBeenCalled();
    });
    it('scopes both data sources to the authenticated account and returns no customer identifiers', async () => {
        const summary = await listenerProfileSummary('own-account', issuer, at(10));
        expect(m.intervals).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'own-account', synthetic: false, sourceCategory: 'beacon' } }));
        expect(m.membership).toHaveBeenCalledWith({ where: { accountId: 'own-account' } });
        expect(summary?.identityKey).toBe(profileIdentityKey(issuer, 'own-subject'));
        expect(JSON.stringify(summary)).not.toContain('own-account'); expect(JSON.stringify(summary)).not.toContain('own-subject');
    });
});
