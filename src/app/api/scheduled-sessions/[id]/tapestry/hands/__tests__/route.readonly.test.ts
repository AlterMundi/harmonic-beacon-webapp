import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

/**
 * TAP-02 review: the public hands sidecar is polled every few seconds, so a
 * GET must be a pure read. This suite deliberately does NOT mock
 * `@/lib/room-entitlement`: the real `resolveRoomViewer` runs against a
 * mocked Prisma, and any create/update/upsert/transaction it (or the route)
 * attempted would be caught by the spies below.
 */

const mocks = vi.hoisted(() => ({
    webSessionFindUnique: vi.fn(),
    sessionFindUnique: vi.fn(),
    participantFindMany: vi.fn(),
    participantFindFirst: vi.fn(),
    participantCreate: vi.fn(),
    participantUpdate: vi.fn(),
    participantUpsert: vi.fn(),
    transaction: vi.fn(),
    listParticipants: vi.fn(),
    tapestryInternalUrl: vi.fn(),
    tapestryParticipantId: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        webSession: { findUnique: mocks.webSessionFindUnique },
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        sessionParticipant: {
            findMany: mocks.participantFindMany,
            findFirst: mocks.participantFindFirst,
            create: mocks.participantCreate,
            update: mocks.participantUpdate,
            upsert: mocks.participantUpsert,
        },
        $transaction: mocks.transaction,
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ listParticipants: mocks.listParticipants }),
    stableRoomIdentity: (_session: string, kind: string, id: string) => `lk-${kind}-${id}`,
}));
vi.mock('@/lib/tapestry', () => ({
    tapestryInternalUrl: mocks.tapestryInternalUrl,
    tapestryParticipantId: mocks.tapestryParticipantId,
}));

import { GET } from '../route';

const SESSION_ID = 'event-1';
const FUTURE = new Date('2027-01-01T00:00:00Z');

function attendeeRequest() {
    return createRequest('http://x', {
        headers: { cookie: 'hb_session=test-token' },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret';
    mocks.webSessionFindUnique.mockResolvedValue({
        displayName: 'Ana',
        displayNameConfirmedAt: new Date('2026-08-01T12:00:00Z'),
        expiresAt: FUTURE,
        revokedAt: null,
        staffUser: null,
        ticketEntitlement: {
            id: 'ticket-1',
            scheduledSessionId: SESSION_ID,
            state: 'BOUND',
            boundEmail: 'ana@example.org',
            expiresAt: FUTURE,
            revokedAt: null,
            commerceEntitlement: null,
        },
    });
    mocks.sessionFindUnique.mockResolvedValue({
        id: SESSION_ID,
        title: 'Event',
        roomName: 'event-stage',
        status: 'LIVE',
        startedAt: null,
        facilitatorId: 'facilitator-1',
    });
    mocks.participantFindFirst.mockResolvedValue(null);
    mocks.participantFindMany.mockResolvedValue([]);
    mocks.listParticipants.mockResolvedValue([]);
    mocks.tapestryInternalUrl.mockReturnValue(null);
    mocks.tapestryParticipantId.mockImplementation((identity: string) => `tp-${identity}`);
});

describe('GET /api/scheduled-sessions/[id]/tapestry/hands — read-only polling', () => {
    it('performs zero writes across repeated polls', async () => {
        for (let poll = 0; poll < 3; poll += 1) {
            const response = await GET(attendeeRequest(), mockParams({ id: SESSION_ID }));
            expect(response.status).toBe(200);
        }

        // The resolver validated session, entitlement and event…
        expect(mocks.webSessionFindUnique).toHaveBeenCalledTimes(3);
        expect(mocks.sessionFindUnique).toHaveBeenCalledTimes(3);
        expect(mocks.participantFindMany).toHaveBeenCalledTimes(3);
        // …without a single mutating Prisma operation.
        expect(mocks.participantCreate).not.toHaveBeenCalled();
        expect(mocks.participantUpdate).not.toHaveBeenCalled();
        expect(mocks.participantUpsert).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('bounds the historical hand query', async () => {
        await GET(attendeeRequest(), mockParams({ id: SESSION_ID }));
        expect(mocks.participantFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 150 }),
        );
    });

    it('rejects an outsider still without writing anything', async () => {
        mocks.webSessionFindUnique.mockResolvedValue(null);

        const response = await GET(attendeeRequest(), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(401);
        expect(mocks.participantCreate).not.toHaveBeenCalled();
        expect(mocks.participantUpdate).not.toHaveBeenCalled();
        expect(mocks.participantUpsert).not.toHaveBeenCalled();
    });
});
