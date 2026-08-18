import { describe, expect, it, vi } from 'vitest';

import {
    ACCOUNT_MAIL_READINESS_URL,
    accountMailReady,
} from '@/lib/account/mail';

const configured = {
    NODE_ENV: 'test' as const,
    BEACON_ACCOUNT_MAIL_DELIVERY_TOKEN: 'a'.repeat(32),
};

describe('Account mail readiness', () => {
    it('fails closed before network access when delivery credentials are absent', async () => {
        const request = vi.fn<typeof fetch>();

        await expect(accountMailReady({ NODE_ENV: 'test' }, request)).resolves.toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('requires the private sidecar to return its exact ready contract', async () => {
        const request = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ status: 'ready' }))
            .mockResolvedValueOnce(Response.json({ status: 'ok' }))
            .mockResolvedValueOnce(Response.json({ status: 'ready' }, { status: 503 }));

        await expect(accountMailReady(configured, request)).resolves.toBe(true);
        await expect(accountMailReady(configured, request)).resolves.toBe(false);
        await expect(accountMailReady(configured, request)).resolves.toBe(false);
        expect(request.mock.calls[0]?.[0]).toBe(ACCOUNT_MAIL_READINESS_URL);
        expect(request.mock.calls[0]?.[1]).toMatchObject({
            method: 'GET', cache: 'no-store', redirect: 'error',
        });
        expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
    });

    it('fails closed on transport and malformed-response failures', async () => {
        const request = vi.fn<typeof fetch>()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValueOnce(new Response('not-json'));

        await expect(accountMailReady(configured, request)).resolves.toBe(false);
        await expect(accountMailReady(configured, request)).resolves.toBe(false);
    });
});
