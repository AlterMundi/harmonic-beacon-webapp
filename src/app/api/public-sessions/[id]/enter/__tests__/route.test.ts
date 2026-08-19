import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const PUBLIC_ID = '50000000-0000-4000-8000-202608220001';
const {
    findUnique,
    ticketCreate,
    webSessionCreate,
    principalFromToken,
    accountIdentityFromToken,
    attachPublicSessionAccess,
} = vi.hoisted(() => ({
    findUnique: vi.fn(),
    ticketCreate: vi.fn(),
    webSessionCreate: vi.fn(),
    principalFromToken: vi.fn(),
    accountIdentityFromToken: vi.fn(),
    attachPublicSessionAccess: vi.fn(),
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
    accountIdentityFromToken,
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
vi.mock('@/lib/public-session-access', () => ({ attachPublicSessionAccess }));

async function enter(
    id = PUBLIC_ID,
    url = `/api/public-sessions/${id}/enter`,
    headers: Record<string, string> = { host: 'localhost:3000' },
) {
    const { GET } = await import('../route');
    return GET(createRequest(url, { headers }), mockParams({ id }));
}

describe('GET /api/public-sessions/[id]/enter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        principalFromToken.mockResolvedValue(null);
        accountIdentityFromToken.mockResolvedValue(null);
        attachPublicSessionAccess.mockResolvedValue(true);
        findUnique.mockResolvedValue({
            id: PUBLIC_ID,
            scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'SCHEDULED',
            isTest: false,
            publicAccess: true,
        });
        ticketCreate.mockResolvedValue({ id: 'ticket-free' });
        webSessionCreate.mockResolvedValue({ id: 'web-free' });
    });

    it('creates opaque free access without requiring an Account session', async () => {
        const response = await enter();

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(`http://localhost:3000/session/${PUBLIC_ID}`);
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

    it('uses the operator-pinned staging origin instead of the internal upstream URL', async () => {
        vi.stubEnv('TICKET_LOGIN_URL_PREFIX', 'https://live-staging.harmonicbeacon.com/');

        const response = await enter(PUBLIC_ID, `/api/public-sessions/${PUBLIC_ID}/enter`, {
            host: '127.0.0.1:3200',
            'x-forwarded-host': 'live.harmonicbeacon.com',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            `https://live-staging.harmonicbeacon.com/session/${PUBLIC_ID}`,
        );
    });

    it('redirects an existing room-bound attendee without creating another entitlement', async () => {
        principalFromToken.mockResolvedValue({
            kind: 'attendee',
            scheduledSessionId: PUBLIC_ID,
        });

        const response = await enter();

        expect(response.status).toBe(303);
        expect(ticketCreate).not.toHaveBeenCalled();
        expect(webSessionCreate).not.toHaveBeenCalled();
    });

    it('preserves an existing staff session instead of replacing its cookie', async () => {
        principalFromToken.mockResolvedValue({ kind: 'staff', userId: 'staff-1' });

        const response = await enter();

        expect(response.status).toBe(303);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(findUnique).not.toHaveBeenCalled();
        expect(ticketCreate).not.toHaveBeenCalled();
    });

    it('attaches public access to an Account session without replacing its identity cookie', async () => {
        accountIdentityFromToken.mockResolvedValue({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-subject',
            sessionId: 'opaque-session',
            displayName: 'Nicolás',
            validatedAt: new Date('2026-08-19T12:00:00.000Z'),
        });

        const response = await enter(PUBLIC_ID, `/api/public-sessions/${PUBLIC_ID}/enter`, {
            host: 'localhost:3000',
            cookie: 'hb_session=account-cookie',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(attachPublicSessionAccess).toHaveBeenCalledWith(
            'account-cookie',
            expect.objectContaining({ id: PUBLIC_ID, publicAccess: true }),
            expect.objectContaining({ subject: 'opaque-subject' }),
            expect.any(Date),
        );
        expect(ticketCreate).not.toHaveBeenCalled();
    });

    it('preserves an Account identity when moving from another public room', async () => {
        principalFromToken.mockResolvedValue({
            kind: 'attendee',
            scheduledSessionId: '50000000-0000-4000-8000-202608220002',
            accountId: 'opaque-subject',
        });
        accountIdentityFromToken.mockResolvedValue({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-subject',
            sessionId: 'opaque-session',
            displayName: 'Nicolás',
            validatedAt: new Date('2026-08-19T12:00:00.000Z'),
        });

        const response = await enter(PUBLIC_ID, `/api/public-sessions/${PUBLIC_ID}/enter`, {
            host: 'localhost:3000',
            cookie: 'hb_session=account-cookie',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(attachPublicSessionAccess).toHaveBeenCalledWith(
            'account-cookie',
            expect.objectContaining({ id: PUBLIC_ID }),
            expect.objectContaining({ subject: 'opaque-subject' }),
            expect.any(Date),
        );
        expect(ticketCreate).not.toHaveBeenCalled();
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
            publicAccess: true,
        });
        expect((await enter()).status).toBe(404);
        expect(ticketCreate).not.toHaveBeenCalled();
    });
});
