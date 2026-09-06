import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const PUBLIC_ID = '50000000-0000-4000-8000-202608220001';
const { findUnique, principalFromToken, accountIdentityFromToken, attachPublicSessionAccess } =
    vi.hoisted(() => ({
        findUnique: vi.fn(),
        principalFromToken: vi.fn(),
        accountIdentityFromToken: vi.fn(),
        attachPublicSessionAccess: vi.fn(),
    }));

vi.mock('@/lib/db', () => ({ prisma: { scheduledSession: { findUnique } } }));
vi.mock('@/lib/principal', () => ({ principalFromToken, accountIdentityFromToken }));
vi.mock('@/lib/public-session-access', () => ({ attachPublicSessionAccess }));

const googleAccount = {
    issuer: 'https://account-staging.harmonicbeacon.com',
    subject: 'opaque-subject',
    sessionId: 'opaque-session',
    displayName: 'Nicolás',
    email: 'nico@example.com',
    emailVerified: true as const,
    authMethod: 'google' as const,
    validatedAt: new Date('2026-08-19T12:00:00.000Z'),
};

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
    });

    it('requires Beacon Account before granting a payment-free event', async () => {
        const response = await enter();

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            `http://localhost:3000/api/account/login?flow=attendee&next=%2Fapi%2Fpublic-sessions%2F${PUBLIC_ID}%2Fenter&method=google`,
        );
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });

    it('attaches verified Google identity without replacing its cookie', async () => {
        accountIdentityFromToken.mockResolvedValue(googleAccount);

        const response = await enter(PUBLIC_ID, undefined, {
            host: 'localhost:3000', cookie: 'hb_session=account-cookie',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(`http://localhost:3000/session/${PUBLIC_ID}`);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(attachPublicSessionAccess).toHaveBeenCalledWith(
            'account-cookie',
            expect.objectContaining({ id: PUBLIC_ID, publicAccess: true }),
            googleAccount,
            expect.any(Date),
        );
    });

    it('rejects a valid Beacon Account that was not authenticated with Google', async () => {
        accountIdentityFromToken.mockResolvedValue({ ...googleAccount, authMethod: 'email' });

        const response = await enter(PUBLIC_ID, undefined, {
            host: 'localhost:3000', cookie: 'hb_session=account-cookie',
        });

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(
            'http://localhost:3000/?account_method=google_required',
        );
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });

    it('fails closed rather than restoring anonymous access when Account is disabled', async () => {
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'false');
        expect((await enter()).status).toBe(503);
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });

    it('preserves an existing staff or same-room attendee session', async () => {
        principalFromToken.mockResolvedValueOnce({ kind: 'staff', userId: 'staff-1' });
        expect((await enter()).status).toBe(303);
        expect(findUnique).not.toHaveBeenCalled();

        principalFromToken.mockResolvedValueOnce({ kind: 'attendee', scheduledSessionId: PUBLIC_ID });
        expect((await enter()).status).toBe(303);
        expect(attachPublicSessionAccess).not.toHaveBeenCalled();
    });

    it('rejects unlisted, test, closed and non-public sessions', async () => {
        expect((await enter('10000000-0000-4000-8000-000000000001')).status).toBe(404);
        expect(findUnique).not.toHaveBeenCalled();

        for (const override of [
            { isTest: true },
            { publicAccess: false },
            { status: 'ENDED' },
        ]) {
            findUnique.mockResolvedValueOnce({
                id: PUBLIC_ID,
                scheduledAt: new Date('2026-08-22T14:00:00.000Z'),
                status: 'SCHEDULED',
                isTest: false,
                publicAccess: true,
                ...override,
            });
            expect((await enter()).status).toBe(404);
        }
    });
});
