import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const requireStaff = vi.fn();
const sessionFindUnique = vi.fn();
const listParticipants = vi.fn();
const tapestryInternalUrl = vi.fn();
const tapestryParticipantId = vi.fn();

vi.mock('@/lib/auth', () => ({ requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: sessionFindUnique },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ listParticipants }),
}));
vi.mock('@/lib/tapestry', () => ({
    tapestryInternalUrl,
    tapestryParticipantId,
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
        tapestryInternalUrl.mockReturnValue(null);
        tapestryParticipantId.mockImplementation((identity: string) => `tp-safe-${identity.slice(-7)}`);
        process.env.TAPESTRY_INTERNAL_SECRET = 'test-tapestry-secret';
        listParticipants.mockResolvedValue([
            {
                identity: 'opaque-publisher',
                name: 'Participant',
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
                    displayName: 'Ana',
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
                    displayName: 'Beto',
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

    afterEach(() => {
        vi.unstubAllGlobals();
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

    it('rejects a facilitator assigned to another event and an unknown session before tapestry lookup', async () => {
        requireStaff.mockResolvedValue([{ ...operator, role: 'FACILITATOR', userId: 'facilitator-elsewhere' }, null]);
        const { GET } = await import('../route');
        const forbidden = await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        );
        expect(forbidden.status).toBe(403);

        sessionFindUnique.mockResolvedValueOnce(null);
        const missing = await GET(
            createRequest('/api/ops/sessions/not-this-event/participants'),
            mockParams({ id: 'not-this-event' }),
        );
        expect(missing.status).toBe(404);
        expect(tapestryInternalUrl).not.toHaveBeenCalled();
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
                { id: 'publisher', displayName: 'Ana', connected: null, media: [], stageState: 'UNKNOWN' },
                { id: 'waiting', displayName: 'Beto', connected: null, media: [] },
            ],
        });
    });

    it('adds bounded private thumbnail references from one batch lookup and falls back when frames are absent', async () => {
        tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            participants: ['tp-safe-blisher'],
            frameTtlMs: 8_000,
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(
            'http://tapestry:3100/tapestry/sessions/event-1/participants',
            expect.objectContaining({ cache: 'no-store' }),
        );
        expect(body).toMatchObject({
            tapestryThumbnailsAvailable: true,
            thumbnailFreshForSeconds: 8,
            participants: [
                { id: 'publisher', thumbnailUrl: expect.stringMatching(/^\/api\/ops\/sessions\/event-1\/tapestry\/tiles\/tp-safe-blisher\?v=\d+$/) },
                { id: 'waiting', thumbnailUrl: null },
            ],
        });
        const serialized = JSON.stringify(body);
        expect(serialized.match(/tapestry\/tiles\//g)).toHaveLength(1);
        expect(serialized).not.toContain('tapestry:3100');
    });

    it('keeps the complete queue response usable when tapestry is offline or returns invalid data', async () => {
        tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/ops/sessions/event-1/participants'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            tapestryThumbnailsAvailable: false,
            thumbnailFreshForSeconds: 10,
            participants: [
                { id: 'publisher', thumbnailUrl: null },
                { id: 'waiting', thumbnailUrl: null },
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
