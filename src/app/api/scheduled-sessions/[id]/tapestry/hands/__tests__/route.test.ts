import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveRoomPrincipal: vi.fn(),
    findMany: vi.fn(),
    listParticipants: vi.fn(),
}));

vi.mock('@/lib/room-entitlement', () => ({
    resolveRoomPrincipal: mocks.resolveRoomPrincipal,
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        sessionParticipant: { findMany: mocks.findMany },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ listParticipants: mocks.listParticipants }),
}));

import { GET } from '../route';

const SESSION_ID = 'event-1';

function entitled() {
    mocks.resolveRoomPrincipal.mockResolvedValue({
        ok: true,
        principal: {
            session: { id: SESSION_ID, roomName: 'event-stage' },
            ticketEntitlementId: 'ticket-1',
        },
    });
}

function participant(overrides: Record<string, unknown> = {}) {
    return {
        participantIdentity: 'lk-ana',
        publishGrantedAt: null,
        publishRevokedAt: null,
        staffUser: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    entitled();
    mocks.findMany.mockResolvedValue([
        participant({ participantIdentity: 'lk-ana' }),
        participant({ participantIdentity: 'lk-beto' }),
    ]);
    mocks.listParticipants.mockResolvedValue([
        { identity: 'lk-ana', name: 'Ana' },
        { identity: 'lk-beto', name: 'Beto' },
    ]);
});

describe('GET /api/scheduled-sessions/[id]/tapestry/hands', () => {
    it('names connected waiting hands in queue order', async () => {
        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({
            hands: [{ name: 'Ana' }, { name: 'Beto' }],
            liveStateAvailable: true,
        });
    });

    it('propagates the entitlement rejection for outsiders', async () => {
        mocks.resolveRoomPrincipal.mockResolvedValue({
            ok: false,
            status: 403,
            error: 'Not authorized',
        });

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(403);
        expect(mocks.findMany).not.toHaveBeenCalled();
    });

    it('excludes publishers, includes re-raisers after a revoked grant', async () => {
        mocks.findMany.mockResolvedValue([
            participant({
                participantIdentity: 'lk-ana',
                publishGrantedAt: new Date('2026-08-04T11:50:00Z'),
            }),
            participant({
                participantIdentity: 'lk-beto',
                publishGrantedAt: new Date('2026-08-04T11:50:00Z'),
                publishRevokedAt: new Date('2026-08-04T11:55:00Z'),
            }),
        ]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(await response.json()).toMatchObject({ hands: [{ name: 'Beto' }] });
    });

    it('omits hands whose owner is no longer connected', async () => {
        mocks.listParticipants.mockResolvedValue([{ identity: 'lk-ana', name: 'Ana' }]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(await response.json()).toMatchObject({ hands: [{ name: 'Ana' }] });
    });

    it('names nobody when LiveKit cannot confirm presence', async () => {
        mocks.listParticipants.mockRejectedValue(new Error('livekit unreachable'));

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ hands: [], liveStateAvailable: false });
    });

    it('uses the staff account name for staff hands', async () => {
        mocks.findMany.mockResolvedValue([
            participant({ staffUser: { name: 'Julián' } }),
        ]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(await response.json()).toMatchObject({ hands: [{ name: 'Julián' }] });
    });
});
