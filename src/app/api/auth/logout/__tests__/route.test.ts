import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';
import { digestSessionToken } from '@/lib/session-auth';

const TOKEN = 'opaque-cookie-value-for-tests';

function mountDb(updateMany = vi.fn().mockResolvedValue({ count: 1 })) {
    const prisma = { webSession: { updateMany } };
    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    return updateMany;
}

function logoutRequest(cookie?: string) {
    return createRequest('/api/auth/logout', {
        method: 'POST',
        headers: cookie ? { cookie: `hb_session=${cookie}` } : {},
    });
}

function sessionCookieOf(response: Response) {
    return (response as unknown as {
        cookies: { get(name: string): { value: string; maxAge?: number } | undefined };
    }).cookies.get('hb_session');
}

describe('POST /api/auth/logout', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
        vi.restoreAllMocks();
    });

    it('revokes the session row and clears the cookie', async () => {
        const updateMany = mountDb();
        const { POST } = await import('../route');

        const response = await POST(logoutRequest(TOKEN));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ ok: true });

        // Server-side revocation is the part that matters: the cookie alone is the
        // credential, so clearing the browser copy is not enough.
        expect(updateMany).toHaveBeenCalledWith({
            where: { tokenDigest: digestSessionToken(TOKEN), revokedAt: null },
            data: { revokedAt: expect.any(Date), revocationReason: 'logout' },
        });

        expect(sessionCookieOf(response)).toMatchObject({
            value: '',
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
    });

    it('answers the same way for a cookie that names nothing', async () => {
        const updateMany = mountDb(vi.fn().mockResolvedValue({ count: 0 }));
        const { POST } = await import('../route');

        const known = await POST(logoutRequest(TOKEN));
        const unknown = await POST(logoutRequest('never-issued-token-value'));

        // Logout must not become a way to test whether a session token is real.
        expect(unknown.status).toBe(known.status);
        expect(await unknown.json()).toEqual(await known.json());
        expect(updateMany).toHaveBeenCalledTimes(2);
    });

    it('succeeds with no cookie at all and does not query the database', async () => {
        const updateMany = mountDb();
        const { POST } = await import('../route');

        const response = await POST(logoutRequest());

        expect(response.status).toBe(200);
        expect(updateMany).not.toHaveBeenCalled();
        expect(sessionCookieOf(response)).toMatchObject({ value: '', maxAge: 0 });
    });

    it('still clears the cookie when the database is unreachable', async () => {
        mountDb(vi.fn().mockRejectedValue(new Error('connection refused')));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { POST } = await import('../route');

        const response = await POST(logoutRequest(TOKEN));

        // Someone walking away from a borrowed device must not be left apparently
        // signed in because of a database blip.
        expect(response.status).toBe(200);
        expect(sessionCookieOf(response)).toMatchObject({ value: '', maxAge: 0 });
        expect(error).toHaveBeenCalled();
        expect(String(error.mock.calls[0][0])).not.toContain(TOKEN);
    });
});
