import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveStaffSession: vi.fn(),
    queryRaw: vi.fn(),
    campaignFindUnique: vi.fn(),
    campaignUpdate: vi.fn(),
    redemptionFindMany: vi.fn(),
    participantFindMany: vi.fn(),
    participantUpdateMany: vi.fn(),
    entitlementUpdateMany: vi.fn(),
    webSessionUpdateMany: vi.fn(),
    auditCreate: vi.fn(),
    removeParticipant: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        $queryRaw: mocks.queryRaw,
        $transaction: vi.fn(),
        promoInvitation: {
            findUnique: mocks.campaignFindUnique,
            update: mocks.campaignUpdate,
        },
        promoRedemption: { findMany: mocks.redemptionFindMany },
        sessionParticipant: {
            findMany: mocks.participantFindMany,
            updateMany: mocks.participantUpdateMany,
        },
        ticketEntitlement: { updateMany: mocks.entitlementUpdateMany },
        webSession: { updateMany: mocks.webSessionUpdateMany },
        auditLog: { create: mocks.auditCreate },
    };
    prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    return { prisma };
});
vi.mock('@/lib/ops-auth', () => ({ resolveStaffSession: mocks.resolveStaffSession }));
vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: (identity: string) => `bed-${identity}`,
    getRoomService: () => ({ removeParticipant: mocks.removeParticipant }),
}));

import { POST } from '../route';

const STAFF = {
    id: 'operator-1',
    email: 'operator@example.invalid',
    name: 'Operator',
    role: 'OPERATOR',
};
const CAMPAIGN = {
    id: '50000000-0000-4000-8000-000000000001',
    scheduledSessionId: '10000000-0000-4000-8000-000000000001',
    disabledAt: null,
    scheduledSession: { roomName: 'event-stage' },
};

function disableRequest(body: Record<string, unknown>) {
    return createRequest('/api/ops/invitations/campaign-1', { method: 'POST', body });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStaffSession.mockResolvedValue(STAFF);
    mocks.campaignFindUnique.mockResolvedValue(CAMPAIGN);
    mocks.campaignUpdate.mockResolvedValue({});
    mocks.redemptionFindMany.mockResolvedValue([
        { ticketEntitlementId: 'entitlement-1' },
        { ticketEntitlementId: 'entitlement-2' },
    ]);
    mocks.participantFindMany.mockResolvedValue([
        { participantIdentity: 'participant-1' },
    ]);
    mocks.participantUpdateMany.mockResolvedValue({ count: 1 });
    mocks.entitlementUpdateMany.mockResolvedValue({ count: 2 });
    mocks.webSessionUpdateMany.mockResolvedValue({ count: 2 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.removeParticipant.mockResolvedValue(undefined);
});

describe('disable promotion invitation', () => {
    it('requires staff mutation authority and an explicit derived-access choice', async () => {
        mocks.resolveStaffSession.mockResolvedValueOnce(null);
        expect((await POST(disableRequest({}), mockParams({ id: CAMPAIGN.id }))).status).toBe(401);

        mocks.resolveStaffSession.mockResolvedValueOnce({ ...STAFF, role: 'FACILITATOR' });
        expect((await POST(disableRequest({}), mockParams({ id: CAMPAIGN.id }))).status).toBe(403);

        const ambiguous = await POST(disableRequest({
            action: 'disable',
            reason: 'Guest list withdrawn',
        }), mockParams({ id: CAMPAIGN.id }));
        expect(ambiguous.status).toBe(400);
        expect(mocks.campaignUpdate).not.toHaveBeenCalled();
    });

    it('can stop new redemption while preserving already-issued entitlements', async () => {
        const { status, body } = await parseResponse(await POST(disableRequest({
            action: 'disable',
            reason: 'Guest list closed',
            revokeDerived: false,
        }), mockParams({ id: CAMPAIGN.id })));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            status: 'DISABLED',
            revokeDerived: false,
            revokedEntitlements: 0,
            mediaCleanupFailed: false,
        });
        expect(mocks.redemptionFindMany).not.toHaveBeenCalled();
        expect(mocks.entitlementUpdateMany).not.toHaveBeenCalled();
        expect(mocks.removeParticipant).not.toHaveBeenCalled();
    });

    it('atomically revokes derived access and removes both stage and bed identities', async () => {
        const { status, body } = await parseResponse(await POST(disableRequest({
            action: 'disable',
            reason: 'Controlled invitation revoked',
            revokeDerived: true,
        }), mockParams({ id: CAMPAIGN.id })));

        expect(status).toBe(200);
        expect(body).toMatchObject({ revokedEntitlements: 2, mediaCleanupFailed: false });
        expect(mocks.entitlementUpdateMany).toHaveBeenCalledOnce();
        expect(mocks.webSessionUpdateMany).toHaveBeenCalledOnce();
        expect(mocks.participantFindMany).toHaveBeenCalledWith({
            where: {
                scheduledSessionId: CAMPAIGN.scheduledSessionId,
                ticketEntitlementId: { in: ['entitlement-1', 'entitlement-2'] },
            },
            select: { participantIdentity: true },
        });
        expect(mocks.participantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                leftAt: expect.any(Date),
                publishGrantedAt: null,
                grantReconcileNeeded: false,
            }),
        }));
        expect(mocks.removeParticipant).toHaveBeenCalledWith('event-stage', 'participant-1');
        expect(mocks.removeParticipant).toHaveBeenCalledWith('beacon', 'bed-participant-1');
        expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'promo.disable',
                metadata: expect.objectContaining({ revokeDerived: true, revokedEntitlements: 2 }),
            }),
        }));
    });

    it('returns a retryable warning when durable revocation succeeds but media cleanup fails', async () => {
        mocks.removeParticipant.mockRejectedValueOnce(new Error('LiveKit unavailable'));
        const { status, body } = await parseResponse(await POST(disableRequest({
            action: 'disable',
            reason: 'Controlled invitation revoked',
            revokeDerived: true,
        }), mockParams({ id: CAMPAIGN.id })));

        expect(status).toBe(202);
        expect(body).toMatchObject({ mediaCleanupFailed: true, revokedEntitlements: 2 });
    });
});
