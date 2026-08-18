import { describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());
vi.mock('@/lib/listener/account-rp', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/listener/account-rp')>(),
    completeListenerAccountCallback: complete,
}));

import { GET } from './route';

function callback(cookie: string) {
    return new Request('https://listen.harmonicbeacon.com/api/account/callback?code=code&state=state', {
        headers: { host: 'listen.harmonicbeacon.com', cookie },
    });
}

describe('Listener RP callback attempt-cookie boundary', () => {
    it.each([
        '__Host-hb_listener_account_attempt=%',
        '__Host-hb_listener_account_attempt=one; __Host-hb_listener_account_attempt=two',
        `__Host-hb_listener_account_attempt=${'a'.repeat(2049)}`,
    ])('turns malformed/duplicate/oversized state into a clean auth error', async (cookie) => {
        complete.mockResolvedValueOnce(null);
        const response = await GET(callback(cookie));
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/?authError=1');
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
        expect(complete).toHaveBeenCalledWith(expect.objectContaining({ attemptCookie: undefined }));
    });
});
