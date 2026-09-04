import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const transaction = {
        $queryRaw: vi.fn(),
        webSession: {
            findFirst: vi.fn(),
            updateMany: vi.fn(),
            update: vi.fn(),
        },
        sessionParticipant: { updateMany: vi.fn() },
    };
    return {
        transaction,
        $transaction: vi.fn(async (operation: (tx: typeof transaction) => unknown) =>
            operation(transaction)),
        readWebSession: vi.fn(),
        readParticipant: vi.fn(),
    };
});

vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: mocks.$transaction,
        webSession: { findFirst: mocks.readWebSession },
        sessionParticipant: { findFirst: mocks.readParticipant },
    },
}));

import {
    AttendeeDisplayNameError,
    confirmAttendeeDisplayName,
    readAttendeeDisplayName,
} from '@/lib/attendee-display-name';

describe('attendee display name', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readWebSession.mockResolvedValue({
            displayName: 'Web alias',
            displayNameConfirmedAt: null,
        });
        mocks.readParticipant.mockResolvedValue(null);
        mocks.transaction.webSession.findFirst.mockResolvedValue({ id: 'web-1' });
        mocks.transaction.webSession.updateMany.mockResolvedValue({ count: 2 });
        mocks.transaction.webSession.update.mockResolvedValue({ id: 'web-1' });
        mocks.transaction.sessionParticipant.updateMany.mockResolvedValue({ count: 1 });
    });

    it('reads the durable participant alias first and requires explicit confirmation', async () => {
        mocks.readParticipant.mockResolvedValue({ displayName: '  Anahí 李  ' });

        await expect(readAttendeeDisplayName('web-1', 'session-1', 'ticket-1'))
            .resolves.toEqual({ displayName: 'Anahí 李', confirmed: false });
    });

    it('does not silently invent a generic alias when no name exists', async () => {
        mocks.readWebSession.mockResolvedValue({
            displayName: null,
            displayNameConfirmedAt: null,
        });

        await expect(readAttendeeDisplayName('web-1', 'session-1', 'ticket-1'))
            .resolves.toEqual({ displayName: '', confirmed: false });
    });

    it('normalizes and converges active devices plus the durable participant atomically', async () => {
        const now = new Date('2026-09-03T15:00:00Z');
        const result = await confirmAttendeeDisplayName({
            webSessionId: 'web-1',
            scheduledSessionId: 'session-1',
            ticketEntitlementId: 'ticket-1',
            displayName: '  Anahí   李  ',
            now,
        });

        expect(result).toEqual({ displayName: 'Anahí 李', confirmed: true });
        expect(mocks.transaction.$queryRaw).toHaveBeenCalledOnce();
        expect(mocks.transaction.webSession.updateMany).toHaveBeenCalledWith({
            where: {
                ticketEntitlementId: 'ticket-1',
                revokedAt: null,
                expiresAt: { gt: now },
            },
            data: { displayName: 'Anahí 李' },
        });
        expect(mocks.transaction.webSession.update).toHaveBeenCalledWith({
            where: { id: 'web-1' },
            data: { displayNameConfirmedAt: now },
        });
        expect(mocks.transaction.sessionParticipant.updateMany).toHaveBeenCalledWith({
            where: {
                scheduledSessionId: 'session-1',
                ticketEntitlementId: 'ticket-1',
            },
            data: { displayName: 'Anahí 李' },
        });
    });

    it.each(['', '   ', 'A\u0000B', 'x'.repeat(61)])('rejects an invalid or overlong name without opening a transaction', async (displayName) => {
        await expect(confirmAttendeeDisplayName({
            webSessionId: 'web-1',
            scheduledSessionId: 'session-1',
            ticketEntitlementId: 'ticket-1',
            displayName,
        })).rejects.toMatchObject({
            code: 'invalid_name',
            status: 400,
        } satisfies Partial<AttendeeDisplayNameError>);
        expect(mocks.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a revoked, expired, or mismatched web session before changing an alias', async () => {
        mocks.transaction.webSession.findFirst.mockResolvedValue(null);

        await expect(confirmAttendeeDisplayName({
            webSessionId: 'web-other',
            scheduledSessionId: 'session-1',
            ticketEntitlementId: 'ticket-1',
            displayName: 'Annie',
        })).rejects.toMatchObject({ code: 'not_authorized', status: 403 });
        expect(mocks.transaction.webSession.updateMany).not.toHaveBeenCalled();
        expect(mocks.transaction.sessionParticipant.updateMany).not.toHaveBeenCalled();
    });
});
