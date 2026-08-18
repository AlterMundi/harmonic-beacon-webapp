import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/account/credential-actions', () => ({ completeEmailAction: mocks.complete }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: mocks.rate }));
vi.mock('@/lib/account/config', () => ({
    isAccountHost: () => true,
    accountRateSecret: () => 'rate-secret-at-least-thirty-two-characters',
}));

import { POST } from './route';

function request(token: string) {
    return new Request('https://account.harmonicbeacon.com/api/account/email-action', {
        method: 'POST',
        headers: { host: 'account.harmonicbeacon.com', 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
    });
}

describe('Account email action admission', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects malformed tokens without touching durable action authority', async () => {
        expect((await POST(request('invalid'))).status).toBe(400);
        expect(mocks.rate).not.toHaveBeenCalled();
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it('does not enter token transactions when durable admission is blocked', async () => {
        mocks.rate.mockResolvedValue(false);
        expect((await POST(request('A'.repeat(43)))).status).toBe(429);
        expect(mocks.complete).not.toHaveBeenCalled();
    });
});
