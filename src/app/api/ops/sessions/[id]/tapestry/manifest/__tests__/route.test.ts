import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    listParticipants: vi.fn(),
    tapestryInternalUrl: vi.fn(),
    tapestryParticipantId: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.sessionFindUnique },
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
const RAISED_AT = new Date('2026-08-04T11:59:00Z');

function staffOk(role = 'OPERATOR', userId = 'staff-1') {
    mocks.requireStaff.mockResolvedValue([{ userId, role }, null]);
}

function sessionOk() {
    mocks.sessionFindUnique.mockResolvedValue({
        id: SESSION_ID,
        roomName: 'event-stage',
        facilitatorId: 'facilitator-1',
        participants: [
            {
                participantIdentity: 'lk-ana',
                displayName: 'Ana',
                leftAt: null,
                raisedAt: RAISED_AT,
                publishGrantedAt: null,
                publishRevokedAt: null,
                staffUser: null,
            },
            {
                participantIdentity: 'lk-beto',
                displayName: 'Beto',
                leftAt: null,
                raisedAt: null,
                publishGrantedAt: null,
                publishRevokedAt: null,
                staffUser: null,
            },
        ],
    });
}

const LAYOUT = {
    revision: 7,
    frameTtlMs: 10_000,
    columns: 2,
    rows: 1,
    tileSizePx: 100,
    cells: [
        { id: 'tp-ana', column: 0, row: 0 },
        { id: 'tp-beto', column: 1, row: 0 },
    ],
};

function tapestryOk() {
    mocks.tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(LAYOUT), { status: 200 }));
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret';
    mocks.tapestryParticipantId.mockImplementation(
        (identity: string) => `tp-${identity.replace('lk-', '')}`,
    );
    mocks.listParticipants.mockResolvedValue([
        {
            identity: 'lk-ana',
            name: 'Participant',
            tracks: [{ sid: 'TR_cam', source: 1, muted: false }],
        },
        {
            identity: 'lk-beto',
            name: 'Participant',
            tracks: [{ sid: 'TR_cam', source: 1, muted: true }],
        },
    ]);
    staffOk();
    sessionOk();
    tapestryOk();
});

describe('GET /api/ops/sessions/[id]/tapestry/manifest', () => {
    it('builds the annotated manifest with one bounded fetch per source', async () => {
        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        const body = await response.json();
        expect(body.sessionId).toBe(SESSION_ID);
        expect(body.liveStateAvailable).toBe(true);
        expect(body.layout).toEqual({ revision: 7, columns: 2, rows: 1, tileSizePx: 100 });
        expect(body.tileFreshForSeconds).toBe(10);
        expect(body.entries).toHaveLength(2);
        expect(body.entries[0]).toMatchObject({
            tileId: 'tp-ana',
            column: 0,
            row: 0,
            displayName: 'Ana',
            handRaised: true,
            queuePosition: 1,
            presence: 'connected',
            camera: 'on',
        });
        // O(1) visual transport: entries never carry per-tile image URLs.
        expect(body.entries[0]).not.toHaveProperty('thumbnailUrl');
        expect(body.entries[1]).toMatchObject({
            tileId: 'tp-beto',
            column: 1,
            row: 0,
            handRaised: false,
            queuePosition: null,
            camera: 'off',
        });
        expect(body.waitingHands).toEqual([
            { displayName: 'Ana', queuePosition: 1, tileId: 'tp-ana' },
        ]);
        // Exactly one internal tapestry call: the build-time layout. No
        // frames are fetched, per tile or otherwise.
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        expect(String(mocks.fetch.mock.calls[0][0])).toBe(
            `http://tapestry:3100/tapestry/sessions/${SESSION_ID}/layout`,
        );
    });

    it('rejects an unauthenticated caller', async () => {
        mocks.requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        ]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(401);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('rejects a facilitator assigned to another event', async () => {
        staffOk('FACILITATOR', 'staff-9');

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('allows the assigned facilitator of this event', async () => {
        staffOk('FACILITATOR', 'facilitator-1');

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(200);
    });

    it('returns 404 for an unknown session', async () => {
        mocks.sessionFindUnique.mockResolvedValue(null);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(404);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('returns 503 when the tapestry service is not configured', async () => {
        mocks.tapestryInternalUrl.mockReturnValue(null);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(503);
    });

    it('returns 503 when the tapestry service fails or answers an invalid layout', async () => {
        mocks.fetch.mockRejectedValue(new Error('connection refused'));
        expect((await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }))).status).toBe(503);

        mocks.fetch.mockResolvedValue(new Response(
            JSON.stringify({ ...LAYOUT, cells: [{ id: 'has spaces', column: 0, row: 0 }] }),
            { status: 200 },
        ));
        expect((await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }))).status).toBe(503);

        // Duplicate tile ids make cell mapping ambiguous: fail safe.
        mocks.fetch.mockResolvedValue(new Response(
            JSON.stringify({
                ...LAYOUT,
                cells: [
                    { id: 'tp-ana', column: 0, row: 0 },
                    { id: 'tp-ana', column: 1, row: 0 },
                ],
            }),
            { status: 200 },
        ));
        expect((await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }))).status).toBe(503);
    });

    it('degrades presence and camera to unknown when LiveKit is down', async () => {
        mocks.listParticipants.mockRejectedValue(new Error('livekit unreachable'));

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.liveStateAvailable).toBe(false);
        expect(body.entries[0]).toMatchObject({ presence: 'unknown', camera: 'unknown' });
        // Names, hands and tiles survive the outage.
        expect(body.entries[0].handRaised).toBe(true);
        expect(body.entries[0].displayName).toBe('Ana');
    });
});
