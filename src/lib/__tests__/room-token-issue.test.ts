import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    webSessionFindUnique: vi.fn(),
    participantFindFirst: vi.fn(),
    participantUpdateMany: vi.fn(),
    commerceUpdateMany: vi.fn(),
    updateParticipant: vi.fn(),
}));

const tx = {
    $queryRaw: mocks.queryRaw,
    webSession: { findUnique: mocks.webSessionFindUnique },
    sessionParticipant: {
        findFirst: mocks.participantFindFirst,
        updateMany: mocks.participantUpdateMany,
    },
    commerceEntitlement: { updateMany: mocks.commerceUpdateMany },
};

vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: mocks.transaction,
    },
}));
vi.mock('@/lib/session-auth', () => ({
    digestSessionToken: (value: string) => `digest:${value}`,
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ updateParticipant: mocks.updateParticipant }),
    stagePublisherPermission: (isAssignedFacilitator: boolean) => ({
        canPublish: true,
        canPublishData: isAssignedFacilitator,
        canSubscribe: true,
        canPublishSources: ['microphone', 'camera'],
    }),
}));

const principal = {
    session: {
        id: 'session-1',
        title: 'Session',
        roomName: 'stage',
        status: 'LIVE' as const,
        startedAt: new Date(),
    },
    identity: 'identity-current',
    displayName: 'Attendee',
    role: 'ATTENDEE' as const,
    isAssignedFacilitator: false,
    canPublish: true,
    ticketEntitlementId: 'ticket-1',
    staffUserId: null,
};

describe('finalizeRoomTokenIssue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transaction.mockImplementation(
            (callback: (client: typeof tx) => unknown) => callback(tx),
        );
        mocks.queryRaw.mockResolvedValue([{
            facilitator_id: 'staff-1',
            room_name: 'stage',
            status: 'LIVE',
        }]);
        mocks.webSessionFindUnique.mockResolvedValue({
            ticketEntitlementId: 'ticket-1',
            revokedAt: null,
            expiresAt: new Date('2026-09-05T18:00:00Z'),
            ticketEntitlement: {
                scheduledSessionId: 'session-1',
                state: 'BOUND',
                revokedAt: null,
                expiresAt: new Date('2026-09-05T18:00:00Z'),
                commerceEntitlement: {
                    id: 'commerce-1',
                    providerState: 'ACTIVE',
                    administrativeState: 'CLEAR',
                },
            },
        });
        mocks.participantFindFirst.mockResolvedValue({
            id: 'participant-1',
            displayName: 'Ana',
            publishGrantedAt: new Date('2026-09-05T12:00:00Z'),
            publishRevokedAt: null,
            grantReconcileNeeded: false,
        });
        mocks.participantUpdateMany.mockResolvedValue({ count: 1 });
        mocks.commerceUpdateMany.mockResolvedValue({ count: 1 });
        mocks.updateParticipant.mockResolvedValue({});
    });

    it('activates publication server-side only for the current durable identity', async () => {
        const { activateRoomPublication } = await import('../room-token-issue');

        await expect(activateRoomPublication({
            cookieValue: 'cookie',
            principal,
            expectedIdentity: 'identity-current',
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(true);
        expect(mocks.updateParticipant).toHaveBeenCalledWith(
            'stage',
            'identity-current',
            {
                name: 'Ana',
                permission: {
                    canPublish: true,
                    canPublishData: false,
                    canSubscribe: true,
                    canPublishSources: ['microphone', 'camera'],
                },
            },
        );

        mocks.participantFindFirst.mockResolvedValue(null);
        await expect(activateRoomPublication({
            cookieValue: 'cookie',
            principal,
            expectedIdentity: 'identity-retired',
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(false);
        expect(mocks.updateParticipant).toHaveBeenCalledTimes(1);
    });

    it('records the returned token horizon only after the current identity and grant match', async () => {
        const { finalizeRoomTokenIssue } = await import('../room-token-issue');
        const tokenExpiresAt = new Date('2026-09-05T17:00:00Z');

        await expect(finalizeRoomTokenIssue({
            cookieValue: 'cookie',
            principal,
            expectedIdentity: principal.identity,
            expectedCanPublish: true,
            tokenExpiresAt,
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(true);

        expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
        expect(mocks.participantUpdateMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                id: 'participant-1',
                participantIdentity: 'identity-current',
            }),
            data: { maxLivekitTokenExpiresAt: tokenExpiresAt },
        });
    });

    it('fails closed when a concurrent identity rotation wins', async () => {
        mocks.participantFindFirst.mockResolvedValue(null);
        const { finalizeRoomTokenIssue } = await import('../room-token-issue');

        await expect(finalizeRoomTokenIssue({
            cookieValue: 'cookie',
            principal,
            expectedIdentity: 'identity-stale',
            expectedCanPublish: true,
            tokenExpiresAt: new Date('2026-09-05T17:00:00Z'),
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(false);
        expect(mocks.participantUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects a ticket token if the session stopped being live', async () => {
        mocks.queryRaw.mockResolvedValueOnce([
            { facilitator_id: 'staff-1', status: 'SCHEDULED' },
        ]);
        const { finalizeRoomTokenIssue } = await import('../room-token-issue');

        await expect(finalizeRoomTokenIssue({
            cookieValue: 'cookie',
            principal,
            expectedIdentity: principal.identity,
            expectedCanPublish: true,
            tokenExpiresAt: new Date('2026-09-05T17:00:00Z'),
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(false);
        expect(mocks.webSessionFindUnique).not.toHaveBeenCalled();
    });

    it('tracks the four-hour staff JWT horizon and rejects a disabled account', async () => {
        const staffPrincipal = {
            ...principal,
            role: 'FACILITATOR' as const,
            isAssignedFacilitator: true,
            ticketEntitlementId: null,
            staffUserId: 'staff-1',
        };
        mocks.webSessionFindUnique.mockResolvedValue({
            staffUserId: 'staff-1',
            revokedAt: null,
            expiresAt: new Date('2026-09-06T13:00:00Z'),
            staffUser: { role: 'FACILITATOR', disabledAt: null },
        });
        const { finalizeRoomTokenIssue } = await import('../room-token-issue');
        const tokenExpiresAt = new Date('2026-09-05T17:00:00Z');

        await expect(finalizeRoomTokenIssue({
            cookieValue: 'staff-cookie',
            principal: staffPrincipal,
            expectedIdentity: principal.identity,
            expectedCanPublish: true,
            tokenExpiresAt,
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(true);
        expect(mocks.participantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { maxLivekitTokenExpiresAt: tokenExpiresAt },
        }));

        mocks.webSessionFindUnique.mockResolvedValue({
            staffUserId: 'staff-1',
            revokedAt: null,
            expiresAt: new Date('2026-09-06T13:00:00Z'),
            staffUser: {
                role: 'FACILITATOR',
                disabledAt: new Date('2026-09-05T12:59:00Z'),
            },
        });
        await expect(finalizeRoomTokenIssue({
            cookieValue: 'staff-cookie',
            principal: staffPrincipal,
            expectedIdentity: principal.identity,
            expectedCanPublish: true,
            tokenExpiresAt,
            now: new Date('2026-09-05T13:00:00Z'),
        })).resolves.toBe(false);
    });
});
