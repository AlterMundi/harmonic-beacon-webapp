import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';
import { contributionRequestDigest } from '@/lib/session-contributions';
import { contributionSubmissionLimiter } from '@/lib/contribution-rate-limit';

/**
 * Route coverage for CHAT-01 (#137). Like the hands sidecar readonly suite,
 * `@/lib/room-entitlement` is NOT mocked: the real viewer gate runs against a
 * mocked Prisma, so cross-session, unauthenticated and spoof cases exercise
 * the same authorization path as production.
 */

const mocks = vi.hoisted(() => ({
    webSessionFindUnique: vi.fn(),
    sessionFindUnique: vi.fn(),
    participantFindFirst: vi.fn(),
    contributionFindUnique: vi.fn(),
    contributionCreate: vi.fn(),
    contributionFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        webSession: { findUnique: mocks.webSessionFindUnique },
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        sessionParticipant: { findFirst: mocks.participantFindFirst },
        sessionContribution: {
            findUnique: mocks.contributionFindUnique,
            create: mocks.contributionCreate,
            findMany: mocks.contributionFindMany,
        },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    stableRoomIdentity: (_session: string, kind: string, id: string) => `lk-${kind}-${id}`,
}));

import { GET, POST } from '../route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FUTURE = new Date('2027-01-01T00:00:00Z');

function request(method: string, body?: unknown, searchParams?: Record<string, string>) {
    return createRequest(`/api/scheduled-sessions/${SESSION_ID}/contributions`, {
        method,
        body,
        searchParams,
        headers: { cookie: 'hb_session=attendee-token' },
    });
}

function mockAttendee(sessionId = SESSION_ID) {
    mocks.webSessionFindUnique.mockResolvedValue({
        displayName: 'Ana',
        expiresAt: FUTURE,
        revokedAt: null,
        staffUser: null,
        ticketEntitlement: {
            id: 'ticket-1',
            scheduledSessionId: sessionId,
            state: 'BOUND',
            boundEmail: 'ana@example.org',
            expiresAt: FUTURE,
            revokedAt: null,
            commerceEntitlement: null,
        },
    });
}

function mockStaff() {
    mocks.webSessionFindUnique.mockResolvedValue({
        displayName: null,
        expiresAt: FUTURE,
        revokedAt: null,
        staffUser: {
            id: 'staff-1',
            name: 'Julián',
            role: 'OPERATOR',
            disabledAt: null,
        },
        ticketEntitlement: null,
    });
}

function mockSession(overrides: Record<string, unknown> = {}) {
    mocks.sessionFindUnique.mockResolvedValue({
        id: SESSION_ID,
        title: 'Event',
        roomName: 'event-stage',
        status: 'LIVE',
        startedAt: null,
        facilitatorId: 'facilitator-1',
        ...overrides,
    });
}

function contributionRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'contrib-1',
        scheduledSessionId: SESSION_ID,
        authorParticipantId: 'participant-1',
        authorDisplayName: 'Ana',
        body: '¿Cómo respiramos? Siento calma',
        visibility: 'NAMED',
        state: 'VISIBLE',
        idempotencyKey: 'key-1',
        requestDigest: contributionRequestDigest('NAMED', '¿Cómo respiramos? Siento calma'),
        createdAt: new Date('2026-08-08T20:00:00.000Z'),
        updatedAt: new Date('2026-08-08T20:00:00.000Z'),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    contributionSubmissionLimiter.reset();
    mockAttendee();
    mockSession();
    mocks.participantFindFirst.mockResolvedValue({ id: 'participant-1' });
    mocks.contributionFindUnique.mockResolvedValue(null);
    mocks.contributionFindMany.mockResolvedValue([]);
});

describe('GET public feed — authorization and bounded reads', () => {
    it('rejects an unauthenticated caller without touching contributions', async () => {
        mocks.webSessionFindUnique.mockResolvedValue(null);

        const { status } = await parseResponse(await GET(request('GET'), mockParams({ id: SESSION_ID })));

        expect(status).toBe(401);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('rejects a ticket bound to another session', async () => {
        mockAttendee(OTHER_SESSION_ID);

        const { status } = await parseResponse(await GET(request('GET'), mockParams({ id: SESSION_ID })));

        expect(status).toBe(403);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('returns 404 for a nonexistent session without leaking anything', async () => {
        mocks.sessionFindUnique.mockResolvedValue(null);

        const { status } = await parseResponse(await GET(request('GET'), mockParams({ id: SESSION_ID })));

        expect(status).toBe(404);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('serves authorized staff the same public reading', async () => {
        mockStaff();

        const { status } = await parseResponse(await GET(request('GET'), mockParams({ id: SESSION_ID })));

        expect(status).toBe(200);
    });

    it('returns only public DTO fields, no-store, bounded at limit + 1', async () => {
        mocks.contributionFindMany.mockResolvedValue([
            contributionRow(),
            contributionRow({ id: 'contrib-2', visibility: 'ANONYMOUS' }),
        ]);

        const response = await GET(request('GET'), mockParams({ id: SESSION_ID }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(mocks.contributionFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 51 }),
        );
        const page = body as { contributions: Array<Record<string, unknown>>; nextCursor: string | null };
        expect(page.contributions[0]).toEqual({
            id: 'contrib-1',
            body: '¿Cómo respiramos? Siento calma',
            displayName: 'Ana',
            visibility: 'NAMED',
            createdAt: '2026-08-08T20:00:00.000Z',
        });
        // ANONYMOUS: no name, no author identifiers anywhere in the payload.
        expect(page.contributions[1].displayName).toBeNull();
        expect(JSON.stringify(body)).not.toContain('participant-1');
        expect(JSON.stringify(body)).not.toContain('ticket-1');
    });

    it('rejects malformed cursor and limit with a 400', async () => {
        const badCursor = await GET(
            request('GET', undefined, { cursor: '%%%' }),
            mockParams({ id: SESSION_ID }),
        );
        expect(badCursor.status).toBe(400);
        const badLimit = await GET(
            request('GET', undefined, { limit: '5000' }),
            mockParams({ id: SESSION_ID }),
        );
        expect(badLimit.status).toBe(400);
    });
});

describe('POST create — authorization', () => {
    const validBody = {
        body: '¿Cómo respiramos? Siento calma',
        visibility: 'NAMED',
        idempotencyKey: 'key-1',
    };

    it('rejects unauthenticated, cross-session and non-LIVE ticket sessions', async () => {
        mocks.webSessionFindUnique.mockResolvedValue(null);
        expect((await POST(request('POST', validBody), mockParams({ id: SESSION_ID }))).status).toBe(401);

        mockAttendee(OTHER_SESSION_ID);
        expect((await POST(request('POST', validBody), mockParams({ id: SESSION_ID }))).status).toBe(403);

        mockAttendee();
        mockSession({ status: 'ENDED' });
        expect((await POST(request('POST', validBody), mockParams({ id: SESSION_ID }))).status).toBe(403);

        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('rejects staff — the audience feed is attendee-only', async () => {
        mockStaff();

        const { status } = await parseResponse(await POST(request('POST', validBody), mockParams({ id: SESSION_ID })));

        expect(status).toBe(403);
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON and non-object payloads', async () => {
        // createRequest always serializes valid JSON; exercise the parse
        // failure branch with a raw NextRequest carrying broken JSON.
        const { NextRequest } = await import('next/server');
        const raw = new NextRequest('http://localhost:3000/x', {
            method: 'POST',
            headers: { cookie: 'hb_session=attendee-token', 'content-type': 'application/json' },
            body: '{not json',
        });
        expect((await POST(raw, mockParams({ id: SESSION_ID }))).status).toBe(400);
        expect((await POST(request('POST', [1, 2, 3]), mockParams({ id: SESSION_ID }))).status).toBe(400);
    });

    it('rejects invalid body, visibility and idempotency key with 400s', async () => {
        for (const payload of [
            { ...validBody, body: '' },
            { ...validBody, body: 'x'.repeat(1001) },
            { ...validBody, body: 42 },
            { ...validBody, visibility: 'PUBLIC' },
            { ...validBody, idempotencyKey: '' },
            { body: 'sin visibilidad' },
        ]) {
            const { status } = await parseResponse(await POST(request('POST', payload), mockParams({ id: SESSION_ID })));
            expect(status).toBe(400);
        }
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('creates with server-resolved identity and ignores any spoofed fields', async () => {
        mocks.contributionCreate.mockImplementation(async ({ data }) => contributionRow({
            body: data.body,
            requestDigest: data.requestDigest,
        }));

        const { status, body } = await parseResponse(await POST(
            request('POST', {
                ...validBody,
                // Spoof attempts — the contract says these are never read.
                participantId: 'someone-else',
                authorId: 'someone-else',
                ticketEntitlementId: 'someone-elses-ticket',
                scheduledSessionId: OTHER_SESSION_ID,
            }),
            mockParams({ id: SESSION_ID }),
        ));

        expect(status).toBe(201);
        const data = mocks.contributionCreate.mock.calls[0][0].data;
        expect(data.authorParticipantId).toBe('participant-1');
        expect(data.scheduledSessionId).toBe(SESSION_ID);
        expect(JSON.stringify(data)).not.toContain('someone-else');
        expect(Object.keys(body as object).sort()).toEqual(
            ['body', 'createdAt', 'displayName', 'id', 'visibility'],
        );
    });

    it('creates an ANONYMOUS contribution whose public DTO carries no name', async () => {
        mocks.contributionCreate.mockImplementation(async ({ data }) => contributionRow({
            visibility: data.visibility,
            requestDigest: data.requestDigest,
        }));

        const { status, body } = await parseResponse(await POST(
            request('POST', { ...validBody, visibility: 'ANONYMOUS' }),
            mockParams({ id: SESSION_ID }),
        ));

        expect(status).toBe(201);
        expect((body as { displayName: string | null }).displayName).toBeNull();
        expect(JSON.stringify(body)).not.toContain('Ana');
    });

    it('replays an identical retry with 200 and the canonical row', async () => {
        mocks.contributionFindUnique.mockResolvedValue(contributionRow());

        const { status, body } = await parseResponse(await POST(request('POST', validBody), mockParams({ id: SESSION_ID })));

        expect(status).toBe(200);
        expect((body as { id: string }).id).toBe('contrib-1');
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('rejects a reused key with a different payload as 409', async () => {
        mocks.contributionFindUnique.mockResolvedValue(contributionRow());

        const { status } = await parseResponse(await POST(
            request('POST', { ...validBody, body: 'otro mensaje distinto' }),
            mockParams({ id: SESSION_ID }),
        ));

        expect(status).toBe(409);
        expect(mocks.contributionCreate).not.toHaveBeenCalled();
    });

    it('answers 429 with Retry-After once the participant budget is spent', async () => {
        mocks.contributionCreate.mockImplementation(async ({ data }) => contributionRow({
            id: `c-${data.idempotencyKey}`,
            idempotencyKey: data.idempotencyKey,
            body: data.body,
            requestDigest: data.requestDigest,
        }));

        for (let i = 0; i < 5; i += 1) {
            const { status } = await parseResponse(await POST(
                request('POST', { ...validBody, idempotencyKey: `burst-${i}`, body: `mensaje ${i}` }),
                mockParams({ id: SESSION_ID }),
            ));
            expect(status).toBe(201);
        }

        const limited = await POST(
            request('POST', { ...validBody, idempotencyKey: 'burst-6', body: 'mensaje 6' }),
            mockParams({ id: SESSION_ID }),
        );
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).not.toBeNull();
        const { body } = await parseResponse(limited);
        expect((body as { error: string }).error).toBe('rate_limited');
        // Body never reaches logs or the error payload.
        expect(JSON.stringify(body)).not.toContain('mensaje 6');
    });
});
