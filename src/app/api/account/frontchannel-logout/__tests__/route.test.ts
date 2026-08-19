import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest } from '@/__tests__/helpers';

const revoke = vi.fn();

vi.mock('@/lib/account-rp', () => ({
    beaconAccountEnabled: () => true,
    accountConfiguration: () => ({ issuer: 'https://account.harmonicbeacon.com' }),
    revokeCentralSession: revoke,
}));

describe('GET /api/account/frontchannel-logout', () => {
    beforeEach(() => {
        revoke.mockReset().mockResolvedValue(1);
    });

    it('permits framing only by the exact central Account origin', async () => {
        const { GET } = await import('../route');
        const response = await GET(createRequest(
            '/api/account/frontchannel-logout?iss=https%3A%2F%2Faccount.harmonicbeacon.com&sid=device-session',
        ));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-security-policy')).toBe(
            "default-src 'none'; frame-ancestors https://account.harmonicbeacon.com",
        );
        expect(revoke).toHaveBeenCalledWith(
            'https://account.harmonicbeacon.com',
            'device-session',
        );
    });
});
