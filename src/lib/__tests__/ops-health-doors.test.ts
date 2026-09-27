import { describe, expect, it, vi } from 'vitest';
const { count, findFirst } = vi.hoisted(() => ({ count: vi.fn(), findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { scheduledSession: { count, findFirst } } }));
import { productionDeps } from '../ops-health';

describe('production overdue event selection', () => {
    it('retains arbitrarily old unopened public events and excludes test/private/unpublished ones', async () => {
        count.mockResolvedValue(4);
        findFirst.mockResolvedValue({ id: 'old-event' });
        const now = new Date('2026-09-27T00:00:00Z');
        expect(await productionDeps({ now }).getUnopenedEvents()).toEqual({ count: 4, oldestId: 'old-event' });
        expect(count).toHaveBeenLastCalledWith({ where: {
            status: 'SCHEDULED', isTest: false, publicAccess: true, isPublished: true,
            scheduledAt: { lt: now },
        } });
        expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: { scheduledAt: 'asc' } }));
    });
    it('keeps an event-scoped cockpit check inside that event', async () => {
        await productionDeps({ sessionId: 'selected-event' }).getUnopenedEvents();
        expect(count).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'selected-event' }) }));
    });
});
