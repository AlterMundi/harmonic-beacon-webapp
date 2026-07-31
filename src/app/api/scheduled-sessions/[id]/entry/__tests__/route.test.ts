import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const { principalFromToken, findUnique } = vi.hoisted(() => ({
    principalFromToken: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock('@/lib/principal', () => ({ principalFromToken }));
vi.mock('@/lib/db', () => ({
    prisma: { scheduledSession: { findUnique } },
}));

const session = {
    id: 'event-1',
    title: 'The Return',
    language: 'SPANISH',
    scheduledAt: new Date('2026-08-01T18:00:00Z'),
    status: 'SCHEDULED',
    facilitatorId: 'facilitator-1',
};

const attendee = {
    kind: 'attendee',
    webSessionId: 'web-1',
    entitlementId: 'ticket-1',
    scheduledSessionId: 'event-1',
    tier: 'GLOBAL_SOUTH',
    codeLastFour: '1234',
};

async function getEntry() {
    const { GET } = await import('../route');
    return parseResponse(await GET(
        createRequest('/api/scheduled-sessions/event-1/entry', {
            headers: { cookie: 'hb_session=opaque' },
        }),
        mockParams({ id: 'event-1' }),
    ));
}

describe('GET /api/scheduled-sessions/[id]/entry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        principalFromToken.mockResolvedValue(attendee);
        findUnique.mockResolvedValue(session);
    });

    it('confirms a valid ticket and returns WAITING before doors open', async () => {
        const { status, body } = await getEntry();
        expect(status).toBe(200);
        expect(body).toEqual({
            state: 'WAITING',
            session: {
                id: 'event-1',
                title: 'The Return',
                language: 'SPANISH',
                scheduledAt: '2026-08-01T18:00:00.000Z',
                status: 'SCHEDULED',
            },
        });
        expect(JSON.stringify(body)).not.toMatch(/token|email|1234/i);
    });

    it.each([
        ['LIVE', 'READY'],
        ['ENDED', 'ENDED'],
        ['CANCELLED', 'CANCELLED'],
    ])('maps %s to %s for an attendee', async (status, expectedState) => {
        findUnique.mockResolvedValue({ ...session, status });
        expect((await getEntry()).body).toMatchObject({ state: expectedState });
    });

    it('never lets a ticket inspect another event', async () => {
        principalFromToken.mockResolvedValue({ ...attendee, scheduledSessionId: 'event-2' });
        expect((await getEntry()).status).toBe(403);
    });

    it('lets assigned facilitators preflight while scheduled', async () => {
        principalFromToken.mockResolvedValue({
            kind: 'staff',
            webSessionId: 'web-staff',
            userId: 'facilitator-1',
            role: 'FACILITATOR',
        });
        expect((await getEntry()).body).toMatchObject({ state: 'READY' });
    });

    it('rejects an unassigned facilitator', async () => {
        principalFromToken.mockResolvedValue({
            kind: 'staff',
            webSessionId: 'web-staff',
            userId: 'facilitator-2',
            role: 'FACILITATOR',
        });
        expect((await getEntry()).status).toBe(403);
    });

    it.each(['OPERATOR', 'ADMIN'])('lets %s preflight any event', async (role) => {
        principalFromToken.mockResolvedValue({
            kind: 'staff',
            webSessionId: 'web-staff',
            userId: 'staff-1',
            role,
        });
        expect((await getEntry()).body).toMatchObject({ state: 'READY' });
    });

    it('does not reveal whether an event exists without a current entitlement', async () => {
        principalFromToken.mockResolvedValue(null);
        expect((await getEntry()).status).toBe(401);
        expect(findUnique).not.toHaveBeenCalled();
    });
});
