import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db', () => ({
    prisma: { scheduledSession: { findMany } },
}));

import {
    listStaffEvents,
    orderStaffEvents,
    staffEventWhere,
    staffLandingPath,
    type StaffEvent,
} from '@/lib/staff-navigation';

function event(
    id: string,
    status: 'LIVE' | 'SCHEDULED',
    facilitatorId = 'facilitator-1',
    scheduledAt = '2026-08-01T18:00:00.000Z',
): StaffEvent {
    return {
        id,
        title: id,
        language: 'SPANISH',
        status,
        scheduledAt: new Date(scheduledAt),
        startedAt: status === 'LIVE' ? new Date() : null,
        isTest: false,
        facilitatorId,
        facilitator: { name: 'Julián' },
    };
}

describe('staff event navigation', () => {
    beforeEach(() => findMany.mockReset());

    it('scopes a facilitator to assignments and gives global roles the hub set', () => {
        expect(staffEventWhere({ id: 'fac-1', role: 'FACILITATOR' })).toEqual({
            status: { in: ['LIVE', 'SCHEDULED'] },
            facilitatorId: 'fac-1',
        });
        for (const role of ['FACILITATOR_OP', 'OPERATOR', 'ADMIN'] as const) {
            expect(staffEventWhere({ id: 'staff-1', role })).toEqual({
                status: { in: ['LIVE', 'SCHEDULED'] },
            });
        }
    });

    it('orders live events first and upcoming events chronologically', () => {
        const ordered = orderStaffEvents([
            event('later', 'SCHEDULED', 'fac-1', '2026-08-03T00:00:00.000Z'),
            event('live', 'LIVE', 'fac-1', '2026-08-04T00:00:00.000Z'),
            event('next', 'SCHEDULED', 'fac-1', '2026-08-02T00:00:00.000Z'),
        ]);
        expect(ordered.map(({ id }) => id)).toEqual(['live', 'next', 'later']);
    });

    it.each(['FACILITATOR', 'FACILITATOR_OP'] as const)(
        'sends %s to its assigned live event, then its next event, then the hub',
        (role) => {
            const staff = { id: 'fac-1', role };
            expect(staffLandingPath(staff, [
                event('future', 'SCHEDULED', 'fac-1', '2026-08-02T00:00:00.000Z'),
                event('live', 'LIVE', 'fac-1', '2026-08-03T00:00:00.000Z'),
            ])).toBe('/ops/events/live');
            expect(staffLandingPath(staff, [
                event('later', 'SCHEDULED', 'fac-1', '2026-08-03T00:00:00.000Z'),
                event('next', 'SCHEDULED', 'fac-1', '2026-08-02T00:00:00.000Z'),
            ])).toBe('/ops/events/next');
            expect(staffLandingPath(staff, [event('other', 'LIVE', 'fac-2')]))
                .toBe('/ops/events');
        },
    );

    it.each(['OPERATOR', 'ADMIN'] as const)(
        'always sends %s to the global hub for zero, one, or multiple sessions',
        (role) => {
            const staff = { id: 'staff-1', role };
            expect(staffLandingPath(staff, [])).toBe('/ops/events');
            expect(staffLandingPath(staff, [event('one', 'LIVE')])).toBe('/ops/events');
            expect(staffLandingPath(staff, [event('one', 'LIVE'), event('two', 'SCHEDULED')]))
                .toBe('/ops/events');
        },
    );

    it('selects durable test state and facilitator identity for the hub', async () => {
        findMany.mockResolvedValue([]);
        await listStaffEvents({ id: 'staff-1', role: 'ADMIN' });
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({
                isTest: true,
                facilitator: { select: { name: true } },
            }),
        }));
    });
});
