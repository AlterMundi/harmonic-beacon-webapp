import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveRoomViewer: vi.fn(),
    findMany: vi.fn(),
    listParticipants: vi.fn(),
    tapestryInternalUrl: vi.fn(),
    tapestryParticipantId: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@/lib/room-entitlement', () => ({
    resolveRoomViewer: mocks.resolveRoomViewer,
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        sessionParticipant: { findMany: mocks.findMany },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ listParticipants: mocks.listParticipants }),
}));
vi.mock('@/lib/tapestry', () => ({
    tapestryInternalUrl: mocks.tapestryInternalUrl,
    tapestryParticipantId: mocks.tapestryParticipantId,
}));

import { GET } from '../route';

const SESSION_ID = 'event-1';

const LAYOUT = {
    revision: 7,
    columns: 2,
    rows: 1,
    tileSizePx: 100,
    cells: [
        { id: 'tp-ana', column: 0, row: 0 },
        { id: 'tp-beto', column: 1, row: 0 },
    ],
};

function entitled() {
    mocks.resolveRoomViewer.mockResolvedValue({
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
    vi.stubGlobal('fetch', mocks.fetch);
    process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret';
    entitled();
    mocks.tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
    mocks.tapestryParticipantId.mockImplementation(
        (identity: string) => `tp-${identity.replace('lk-', '')}`,
    );
    mocks.findMany.mockResolvedValue([
        participant({ participantIdentity: 'lk-ana' }),
        participant({ participantIdentity: 'lk-beto' }),
    ]);
    mocks.listParticipants.mockResolvedValue([
        { identity: 'lk-ana', name: 'Ana' },
        { identity: 'lk-beto', name: 'Beto' },
    ]);
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(LAYOUT), { status: 200 }));
});

describe('GET /api/scheduled-sessions/[id]/tapestry/hands', () => {
    it('names connected waiting hands in queue order with their grid cells', async () => {
        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({
            hands: [
                { name: 'Ana', column: 0, row: 0 },
                { name: 'Beto', column: 1, row: 0 },
            ],
            liveStateAvailable: true,
            layout: { revision: 7, columns: 2, rows: 1, tileSizePx: 100 },
        });
        // One bounded layout fetch, internal-secret gated.
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = mocks.fetch.mock.calls[0];
        expect(String(url)).toBe(`http://tapestry:3100/tapestry/sessions/${SESSION_ID}/layout`);
        expect(init.headers['x-tapestry-internal-secret']).toBe('test-secret');
    });

    it('still names hands without cells when the layout is unavailable', async () => {
        mocks.fetch.mockResolvedValue(new Response('{}', { status: 404 }));

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(await response.json()).toEqual({
            hands: [
                { name: 'Ana', column: null, row: null },
                { name: 'Beto', column: null, row: null },
            ],
            liveStateAvailable: true,
            layout: null,
        });
    });

    it('propagates the entitlement rejection for outsiders', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({
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
        expect(await response.json()).toMatchObject({ hands: [{ name: 'Beto', column: 1 }] });
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
        expect(await response.json()).toEqual({
            hands: [],
            liveStateAvailable: false,
            layout: null,
        });
    });

    it('uses the staff account name for staff hands', async () => {
        mocks.findMany.mockResolvedValue([
            participant({ staffUser: { name: 'Julián' } }),
        ]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(await response.json()).toMatchObject({ hands: [{ name: 'Julián' }] });
    });
});
