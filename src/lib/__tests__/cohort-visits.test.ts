import { beforeEach, describe, expect, it, vi } from 'vitest';
const { createMany } = vi.hoisted(() => ({ createMany: vi.fn().mockResolvedValue({ count: 1 }) }));
vi.mock('@/lib/db', () => ({ prisma: { auditLog: { createMany } } }));
import { recordCohortVisit, COHORT_VISITS_CUTOFF } from '../cohort-visits';

const account = { issuer: 'https://account.harmonicbeacon.com', subject: 'test-sub',
    sessionId: 'private-session', displayName: 'Private Name', email: 'private@example.invalid',
    validatedAt: new Date() };
describe('cohort visit observations', () => {
    beforeEach(() => vi.clearAllMocks());
    it('records nothing before cutoff', async () => {
        expect(await recordCohortVisit(account, 'landing', new Date(Date.parse(COHORT_VISITS_CUTOFF) - 1))).toBe(false);
        expect(createMany).not.toHaveBeenCalled();
    });
    it('uses server identity/time without token or personal profile', async () => {
        const now = new Date(COHORT_VISITS_CUTOFF);
        expect(await recordCohortVisit(account, 'session', now)).toBe(true);
        const call = createMany.mock.calls[0][0];
        expect(call.skipDuplicates).toBe(true);
        expect(call.data[0].createdAt).toEqual(now);
        expect(call.data[0].metadata).toEqual({ issuer: account.issuer, subject: account.subject, surface: 'session' });
        expect(JSON.stringify(call)).not.toContain('private');
        expect(JSON.stringify(call)).not.toContain('Private Name');
    });
    it('deduplicates same identity/surface/minute and distinguishes later observations', async () => {
        await recordCohortVisit(account, 'landing', new Date('2026-09-23T21:00:01Z'));
        await recordCohortVisit({ ...account, sessionId: 'another-device' }, 'landing', new Date('2026-09-23T21:00:59Z'));
        await recordCohortVisit(account, 'landing', new Date('2026-09-23T21:01:01Z'));
        await recordCohortVisit({ ...account, subject: 'other' }, 'landing', new Date('2026-09-23T21:00:01Z'));
        await recordCohortVisit(account, 'session', new Date('2026-09-23T21:00:01Z'));
        const ids = createMany.mock.calls.map(([x]) => x.data[0].id);
        expect(ids[0]).toBe(ids[1]);
        expect(new Set(ids).size).toBe(4);
    });
});
