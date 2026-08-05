import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    contributionFindMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        sessionContribution: { findMany: mocks.contributionFindMany },
    },
}));

import { GET } from '../route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function staffPrincipal(role: string, userId = 'staff-1') {
    return [{ kind: 'staff', webSessionId: 'ws-1', userId, role }, null];
}

function staffRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'contrib-1',
        scheduledSessionId: SESSION_ID,
        authorParticipantId: 'participant-1',
        authorDisplayName: 'Ana',
        body: '¿Cómo respiramos? Siento calma',
        visibility: 'ANONYMOUS',
        state: 'VISIBLE',
        idempotencyKey: 'key-1',
        requestDigest: 'a'.repeat(64),
        createdAt: new Date('2026-08-08T20:00:00.000Z'),
        updatedAt: new Date('2026-08-08T20:00:00.000Z'),
        authorParticipant: { participantIdentity: 'lk-ticket-t1' },
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionFindUnique.mockResolvedValue({
        id: SESSION_ID,
        facilitatorId: 'facilitator-1',
    });
    mocks.contributionFindMany.mockResolvedValue([staffRow()]);
});

describe('GET /api/ops/sessions/[id]/contributions — staff feed', () => {
    it('rejects unauthenticated and ticket holders before any read', async () => {
        mocks.requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        ]);
        expect((await GET(createRequest('/x'), mockParams({ id: SESSION_ID }))).status).toBe(401);

        mocks.requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
        ]);
        expect((await GET(createRequest('/x'), mockParams({ id: SESSION_ID }))).status).toBe(403);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('returns 404 for a nonexistent session', async () => {
        mocks.requireStaff.mockResolvedValue(staffPrincipal('ADMIN'));
        mocks.sessionFindUnique.mockResolvedValue(null);

        expect((await GET(createRequest('/x'), mockParams({ id: SESSION_ID }))).status).toBe(404);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('rejects a facilitator not assigned to the event', async () => {
        mocks.requireStaff.mockResolvedValue(staffPrincipal('FACILITATOR', 'someone-else'));

        expect((await GET(createRequest('/x'), mockParams({ id: SESSION_ID }))).status).toBe(403);
        expect(mocks.contributionFindMany).not.toHaveBeenCalled();
    });

    it('admits the assigned facilitator', async () => {
        mocks.requireStaff.mockResolvedValue(staffPrincipal('FACILITATOR', 'facilitator-1'));

        expect((await GET(createRequest('/x'), mockParams({ id: SESSION_ID }))).status).toBe(200);
    });

    it('shows the real author and the audience anonymity flag for ANONYMOUS', async () => {
        mocks.requireStaff.mockResolvedValue(staffPrincipal('OPERATOR'));

        const response = await GET(createRequest('/x'), mockParams({ id: SESSION_ID }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const page = body as { contributions: Array<Record<string, unknown>> };
        expect(page.contributions[0]).toEqual({
            id: 'contrib-1',
            body: '¿Cómo respiramos? Siento calma',
            authorDisplayName: 'Ana',
            participantIdentity: 'lk-ticket-t1',
            visibility: 'ANONYMOUS',
            audienceAnonymous: true,
            state: 'VISIBLE',
            createdAt: '2026-08-08T20:00:00.000Z',
        });
        // The staff DTO stays bounded: no ticket id, email or session internals.
        expect(JSON.stringify(body)).not.toContain('ticket-1@');
        expect(JSON.stringify(body)).not.toContain('ana@example.org');
        expect(Object.keys(page.contributions[0]).sort()).toEqual([
            'audienceAnonymous', 'authorDisplayName', 'body', 'createdAt',
            'id', 'participantIdentity', 'state', 'visibility',
        ]);
    });

    it('bounds the read at limit + 1 and rejects a bad limit', async () => {
        mocks.requireStaff.mockResolvedValue(staffPrincipal('ADMIN'));

        await GET(createRequest('/x'), mockParams({ id: SESSION_ID }));
        expect(mocks.contributionFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 51 }),
        );

        const bad = await GET(
            createRequest('/x', { searchParams: { limit: '0' } }),
            mockParams({ id: SESSION_ID }),
        );
        expect(bad.status).toBe(400);
    });
});
