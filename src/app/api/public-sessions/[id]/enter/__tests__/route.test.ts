import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const PUBLIC_ID = '50000000-0000-4000-8000-202608220001';
const { findUnique, ticketCreate, webSessionCreate, principalFromToken } = vi.hoisted(() => ({
    findUnique: vi.fn(),
    ticketCreate: vi.fn(),
    webSessionCreate: vi.fn(),
    principalFromToken: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique },
        $transaction: vi.fn(async (callback) => callback({
            ticketEntitlement: { create: ticketCreate },
            webSession: { create: webSessionCreate },
        })),
    },
}));
vi.mock('@/lib/principal', () => ({
    principalFromToken,
    newSessionToken: () => ({
        cookieValue: 'opaque-public-cookie',
        database: { tokenDigest: 'a'.repeat(64) },
    }),
    webSessionExpiry: () => new Date('2026-08-25T12:00:00.000Z'),
    sessionCookie: (value: string) => ({
        name: 'hb_session',
        value,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
    }),
}));

async function enter(id = PUBLIC_ID) {
    const { GET } = await import('../route');
    return GET(
        createRequest(`/api/public-sessions/${id}/enter`),
        mockParams({ id }),
    );
}

describe('GET /api/public-sessions/[id]/enter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        principalFromToken.mockResolvedValue(null);
        findUnique.mockResolvedValue({
            id: PUBLIC_ID,
            scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'SCHEDULED',
            isTest: false,
        });
        ticketCreate.mockResolvedValue({ id: 'ticket-free' });
        webSessionCreate.mockResolvedValue({ id: 'web-free' });
    });

    it('creates opaque free access and redirects directly to the waiting room', async () => {
        const response = await enter();

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(`https://live.harmonicbeacon.com/session/${PUBLIC_ID}`);
        expect(response.headers.get('set-cookie')).toContain('hb_session=opaque-public-cookie');
        expect(ticketCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                scheduledSessionId: PUBLIC_ID,
                tier: 'COMP',
                state: 'BOUND',
                codeLastFour: 'FREE',
            }),
        }));
        expect(webSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects every session outside the four published rooms before database access', async () => {
        const response = await enter('10000000-0000-4000-8000-000000000001');
        expect(response.status).toBe(404);
        expect(findUnique).not.toHaveBeenCalled();
        expect(ticketCreate).not.toHaveBeenCalled();
    });

    it('does not issue access after a room is ended', async () => {
        findUnique.mockResolvedValue({
            id: PUBLIC_ID,
            scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'ENDED',
            isTest: false,
        });
        expect((await enter()).status).toBe(404);
        expect(ticketCreate).not.toHaveBeenCalled();
    });
});
