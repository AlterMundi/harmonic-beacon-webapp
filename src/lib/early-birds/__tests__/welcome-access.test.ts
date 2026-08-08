import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
    earlyBirdFreeSchedule: { findUnique: vi.fn() },
    earlyBirdWelcomeAccess: { findUnique: vi.fn(), create: vi.fn() },
    earlyBirdStreamLease: { updateMany: vi.fn() },
}));
const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
}));

vi.mock('@/lib/db', () => ({ prisma }));

import {
    EARLY_BIRD_WELCOME_DURATION_MS,
    EarlyBirdWelcomeAccessUnavailableError,
    startEarlyBirdWelcomeAccess,
    welcomeAccessState,
} from '../welcome-access';

const NOW = new Date('2026-08-07T15:30:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';

function row() {
    return {
        accountId: 'listener-1',
        startedAt: NOW,
        endsAt: new Date(NOW.getTime() + EARLY_BIRD_WELCOME_DURATION_MS),
        activationRequestId: REQUEST_ID,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

describe('one-time Listener welcome access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 'listener-1' }]);
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue(null);
        tx.earlyBirdWelcomeAccess.create.mockResolvedValue(row());
        tx.earlyBirdStreamLease.updateMany.mockResolvedValue({ count: 0 });
    });

    it('starts exactly thirty minutes only after the explicit idempotent command', async () => {
        const result = await startEarlyBirdWelcomeAccess({
            accountId: 'listener-1',
            activationRequestId: REQUEST_ID,
            now: NOW,
        });

        expect(result.state).toMatchObject({ available: false, active: true, used: true });
        expect(tx.earlyBirdWelcomeAccess.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                startedAt: NOW,
                endsAt: new Date(NOW.getTime() + 30 * 60 * 1000),
            }),
        });
    });

    it('replays the same activation without extending the original end', async () => {
        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue(row());

        const result = await startEarlyBirdWelcomeAccess({
            accountId: 'listener-1',
            activationRequestId: REQUEST_ID,
            now: new Date(NOW.getTime() + 5 * 60 * 1000),
        });

        expect(result.replayed).toBe(true);
        expect(result.access.endsAt).toEqual(new Date(NOW.getTime() + 30 * 60 * 1000));
        expect(tx.earlyBirdWelcomeAccess.create).not.toHaveBeenCalled();
    });

    it('fails closed after any prior use or recurring schedule selection', async () => {
        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue({ ...row(), activationRequestId: 'other' });
        await expect(startEarlyBirdWelcomeAccess({
            accountId: 'listener-1',
            activationRequestId: REQUEST_ID,
            now: NOW,
        })).rejects.toBeInstanceOf(EarlyBirdWelcomeAccessUnavailableError);

        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue(null);
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue({ accountId: 'listener-1' });
        await expect(startEarlyBirdWelcomeAccess({
            accountId: 'listener-1',
            activationRequestId: REQUEST_ID,
            now: NOW,
        })).rejects.toBeInstanceOf(EarlyBirdWelcomeAccessUnavailableError);
    });

    it('does not expose an unused welcome when eligibility is absent', () => {
        expect(welcomeAccessState(null, NOW, false)).toEqual({
            available: false,
            active: false,
            used: false,
            startedAt: null,
            endsAt: null,
        });
    });
});
