import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const requireStaff = vi.fn();
const sessionFindUnique = vi.fn();
const listParticipants = vi.fn();

vi.mock('@/lib/auth', () => ({ requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: sessionFindUnique },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ listParticipants }),
}));

const operator = {
    kind: 'staff',
    webSessionId: 'web-1',
    userId: 'operator-1',
    role: 'OPERATOR',
};

describe('GET /api/ops/sessions/[id]/participants', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireStaff.mockResolvedValue([operator, null]);
        listParticipants.mockResolvedValue([
            {
                identity: 'opaque-publisher',
                name: 'Ana',
                tracks: [
                    {
                        sid: 'TR_audio',
                        source: 2,
                        muted: false,
                    },
                ],
            },
        ]);
        sessionFindUnique.mockResolvedValue({
            id: 'event-1',
            roomName: 'event-stage',
            facilitatorId: 'facilitator-1',
            maxPublishers: 6,
            participants: [
                {
                    id: 'publisher',
                    participantIdentity: 'opaque-publisher',
                    joinedAt: new Date('2026-08-01T15:00:00Z'),
                    leftAt: null,
                    raisedAt: null,
                    publishGrantedAt: new Date('2026-08-01T15:10:00Z'),
                    publishRevokedAt: null,
                    grantVersion: 1,
                    grantReconcileNeeded: false,
                    staffUser: null,
                },
                {
                    id: 'waiting',
                    participantIdentity: 'opaque-waiting',
                    joinedAt: new Date('2026-08-01T15:01:00Z'),
                    leftAt: null,
                    raisedAt: new Date('2026-08-01T15:11:00Z'),
                    publishGrantedAt: null,
                    publishRevokedAt: null,
                    grantVersion: 0,
                    grantReconcileNeeded: true,
                    staffUser: null,
                },
            ],
        });
    });

    it('marks facilitator assignment explicitly instead of inferring it from role', async () => {
        sessionFindUnique.mockResolvedValue({
            id: 'event-1',
            roomName: 'event-stage',
            facilitatorId: 'facilitator-op-1',
            maxPublishers: 6,
            participants: [
                {
                    id: 'conductor',
                    participantIdentity: 'opaque-conductor',
                    joinedAt: new Date('2026-08-01T15:00:00Z'),
                    leftAt: null,
                    raisedAt: null,
                    publishGrantedAt: new Date('2026-08-01T15:00:00Z'),
                    publishRevokedAt: null,
                    grantVersion: 1,
                    grantReconcileNeeded: false,
                    staffUser: {
                        id: 'facilitator-op-1',
                        name: 'Julián',
                        role: 'FACILITATOR_OP',
                    },
                },
            ],
        });
        listParticipants.mockResolvedValue([]);

        const { GET } = await import('../route');
        const { body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(body).toMatchObject({
            activePublishers: 0,
            grantedPublishers: 1,
            participants: [{
                staffRole: 'FACILITATOR_OP',
                isAssignedFacilitator: true,
                stageState: 'RECONNECTING',
            }],
        });
    });

    it('rejects an attendee before reading participant state', async () => {
        requireStaff.mockResolvedValue([
            null,
            NextResponse.json(
                { error: 'Insufficient permissions' },
                { status: 403 },
            ),
        ]);
        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(403);
        expect(sessionFindUnique).not.toHaveBeenCalled();
    });

    it('lists room display names, durable grants, queue positions, and reconcile state without private admission data', async () => {
        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            sessionId: 'event-1',
            maxPublishers: 6,
            activePublishers: 1,
            grantedPublishers: 2,
            participants: [
                {
                    id: 'publisher',
                    displayName: 'Ana',
                    canPublish: true,
                    stageState: 'ON_STAGE',
                    queuePosition: null,
                    connected: true,
                    media: [
                        {
                            trackSid: 'TR_audio',
                            source: 'MICROPHONE',
                            muted: false,
                        },
                    ],
                },
                {
                    id: 'waiting',
                    canPublish: false,
                    queuePosition: 1,
                    reconcileNeeded: true,
                    connected: false,
                    stageState: 'AUDIENCE',
                },
            ],
        });
        expect(JSON.stringify(body)).not.toMatch(/email|ticket|code/i);
    });

    it('keeps durable controls available while marking live state unknown when LiveKit fails', async () => {
        listParticipants.mockRejectedValue(new Error('LiveKit unavailable'));
        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            liveStateAvailable: false,
            participants: [
                { id: 'publisher', connected: null, media: [], stageState: 'UNKNOWN' },
                { id: 'waiting', connected: null, media: [] },
            ],
        });
    });

    it('keeps a granted reconnect out of the effective stage until media is published again', async () => {
        listParticipants.mockResolvedValue([]);
        const { GET } = await import('../route');
        const { body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(body).toMatchObject({
            activePublishers: 0,
            grantedPublishers: 2,
        });
        const snapshot = body as { participants: Array<{ id: string }> };
        expect(snapshot.participants.find((participant) => participant.id === 'publisher'))
            .toMatchObject({
                canPublish: true,
                connected: false,
                stageState: 'RECONNECTING',
            });
    });
});
