import type { EarlyBirdFreeSchedule } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdFreeSchedule: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    earlyBirdStreamLease: { updateMany: vi.fn() },
}));
const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    earlyBirdFreeSchedule: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import {
    EarlyBirdFreeWindowCooldownError,
    canonicalIanaTimeZone,
    freeWindowState,
    selectEarlyBirdFreeWindow,
    wallClockInstant,
} from '../free-window';

const NOW = new Date('2026-08-07T15:30:00.000Z');

function schedule(overrides: Partial<EarlyBirdFreeSchedule> = {}): EarlyBirdFreeSchedule {
    return {
        accountId: 'listener-1',
        timeZone: 'America/Argentina/Cordoba',
        localStartMinute: 12 * 60 + 30,
        selectedAt: new Date('2026-08-01T12:00:00.000Z'),
        changeAllowedAt: new Date('2026-08-08T12:00:00.000Z'),
        selectionRequestId: '00000000-0000-4000-8000-000000000001',
        revision: 1,
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
        updatedAt: new Date('2026-08-01T12:00:00.000Z'),
        ...overrides,
    };
}

describe('weekly-locked daily Free window', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 'listener-1' }]);
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.updateMany.mockResolvedValue({ count: 0 });
    });

    it('canonicalizes IANA zones and rejects non-zones', () => {
        expect(canonicalIanaTimeZone('America/Argentina/Cordoba')).toBe('America/Cordoba');
        expect(() => canonicalIanaTimeZone('not/a-zone')).toThrow(/IANA/);
    });

    it('authorizes exactly two real hours and returns the next daily window', () => {
        const active = freeWindowState(schedule(), NOW);
        expect(active).toMatchObject({
            active: true,
            activeStart: new Date('2026-08-07T15:30:00.000Z'),
            activeEnd: new Date('2026-08-07T17:30:00.000Z'),
            nextStart: new Date('2026-08-08T15:30:00.000Z'),
        });

        expect(freeWindowState(schedule(), active.activeEnd!)).toMatchObject({
            active: false,
            nextStart: new Date('2026-08-08T15:30:00.000Z'),
        });
    });

    it('advances a nonexistent spring-forward minute and chooses the first fall-back occurrence', () => {
        expect(wallClockInstant(
            { year: 2026, month: 3, day: 8 },
            2 * 60 + 30,
            'America/New_York',
        )).toEqual(new Date('2026-03-08T07:00:00.000Z'));

        expect(wallClockInstant(
            { year: 2026, month: 11, day: 1 },
            1 * 60 + 30,
            'America/New_York',
        )).toEqual(new Date('2026-11-01T05:30:00.000Z'));
    });

    it('derives Listen free now from server time and locks it for rolling seven days', async () => {
        tx.earlyBirdFreeSchedule.create.mockImplementation(({ data }) => schedule({
            ...data,
            createdAt: NOW,
            updatedAt: NOW,
        }));

        const result = await selectEarlyBirdFreeWindow({
            accountId: 'listener-1',
            mode: 'now',
            timeZone: 'America/Argentina/Cordoba',
            selectionRequestId: '00000000-0000-4000-8000-000000000002',
            now: NOW,
        });

        expect(result.schedule).toMatchObject({
            localStartMinute: 12 * 60 + 30,
            selectedAt: NOW,
            changeAllowedAt: new Date('2026-08-14T15:30:00.000Z'),
            revision: 1,
        });
        expect(result.state.active).toBe(true);
    });

    it('replays the same request ID but rejects a new selection during cooldown', async () => {
        const existing = schedule({
            selectionRequestId: '00000000-0000-4000-8000-000000000003',
            changeAllowedAt: new Date('2026-08-14T15:30:00.000Z'),
        });
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(existing);

        await expect(selectEarlyBirdFreeWindow({
            accountId: 'listener-1',
            mode: 'now',
            timeZone: existing.timeZone,
            selectionRequestId: existing.selectionRequestId,
            now: NOW,
        })).resolves.toMatchObject({ replayed: true, schedule: existing });

        await expect(selectEarlyBirdFreeWindow({
            accountId: 'listener-1',
            mode: 'custom',
            timeZone: existing.timeZone,
            localStartMinute: 600,
            selectionRequestId: '00000000-0000-4000-8000-000000000004',
            now: NOW,
        })).rejects.toBeInstanceOf(EarlyBirdFreeWindowCooldownError);
    });

    it('evicts current leases when an unlocked schedule is changed', async () => {
        const existing = schedule({ changeAllowedAt: new Date('2026-08-07T15:00:00.000Z') });
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(existing);
        tx.earlyBirdFreeSchedule.update.mockImplementation(({ data }) => schedule({
            ...data,
            createdAt: existing.createdAt,
            updatedAt: NOW,
        }));

        await selectEarlyBirdFreeWindow({
            accountId: 'listener-1',
            mode: 'custom',
            timeZone: 'UTC',
            localStartMinute: 900,
            selectionRequestId: '00000000-0000-4000-8000-000000000005',
            now: NOW,
        });

        expect(tx.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: { accountId: 'listener-1', evictedAt: null },
            data: { evictedAt: NOW },
        });
    });
});
