import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const PUBLIC_ID = '50000000-0000-4000-8000-202608220001';
const {
    findUnique,
    accountIdentityFromToken,
    attachPublicSessionAccess,
} = vi.hoisted(() => ({
    findUnique: vi.fn(),
    accountIdentityFromToken: vi.fn(),
    attachPublicSessionAccess: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique },
    },
}));
vi.mock('@/lib/principal', () => ({
    accountIdentityFromToken,
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
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'true');
        accountIdentityFromToken.mockResolvedValue(null);
        attachPublicSessionAccess.mockResolvedValue(true);
        findUnique.mockResolvedValue({
            id: PUBLIC_ID,
            scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'SCHEDULED',
            isTest: false,
            publicAccess: true,
        });
    });

    it('requires Beacon Account before creating any public-event access', async () => {
        const response = await enter();

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            `http://localhost:3000/api/account/login?flow=attendee&next=%2Fsession%2F${PUBLIC_ID}`,
        );
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(findUnique).not.toHaveBeenCalled();
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });

    it('uses the operator-pinned staging origin instead of the internal upstream URL', async () => {
        vi.stubEnv('TICKET_LOGIN_URL_PREFIX', 'https://live-staging.harmonicbeacon.com/');

        const response = await enter(PUBLIC_ID, `/api/public-sessions/${PUBLIC_ID}/enter`, {
            host: '127.0.0.1:3200',
            'x-forwarded-host': 'live.harmonicbeacon.com',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            `https://live-staging.harmonicbeacon.com/api/account/login?flow=attendee&next=%2Fsession%2F${PUBLIC_ID}`,
        );
    });

    it('fails closed when the Account boundary is disabled', async () => {
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'false');
        const response = await enter();

        expect(response.status).toBe(503);
        expect(findUnique).not.toHaveBeenCalled();
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
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
    });

    it('rebinds the current Account identity when moving from another public room', async () => {
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
    });

    it('rejects every session outside the four published rooms before database access', async () => {
        const response = await enter('10000000-0000-4000-8000-000000000001');
        expect(response.status).toBe(404);
        expect(findUnique).not.toHaveBeenCalled();
    });

    it('does not issue access after a room is ended', async () => {
        accountIdentityFromToken.mockResolvedValue({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: 'opaque-subject',
            sessionId: 'opaque-session',
            displayName: 'Nicolás',
            validatedAt: new Date('2026-08-19T12:00:00.000Z'),
        });
        findUnique.mockResolvedValue({
            id: PUBLIC_ID,
            scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
            status: 'ENDED',
            isTest: false,
            publicAccess: true,
        });
        expect((await enter(PUBLIC_ID, `/api/public-sessions/${PUBLIC_ID}/enter`, {
            host: 'localhost:3000',
            cookie: 'hb_session=account-cookie',
        })).status).toBe(404);
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });
});
