import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const redeemFreeThroughCanonicalGateway = vi.hoisted(() => vi.fn());

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/membership-gateway', () => ({
    EarlyBirdMembershipGatewayUnavailableError: class extends Error {},
    redeemFreeThroughCanonicalGateway,
}));

import { POST } from '../route';

function request(token = 'a'.repeat(43)) {
    return new NextRequest('https://live.example.test/api/early-birds/free/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
    });
}

afterEach(() => vi.clearAllMocks());

describe('EarlyBird Free redemption boundary', () => {
    it('never sends an invitation to the canonical authority before EarlyBird auth', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
    });

    it('passes the opaque token and account id to the canonical gateway after auth', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({
            ok: true,
            replayed: false,
            alreadyEntitled: false,
        });
        const token = 'opaque_'.padEnd(43, 'x');
        const response = await POST(request(token));
        expect(response.status).toBe(200);
        expect(redeemFreeThroughCanonicalGateway).toHaveBeenCalledWith('listener-1', token);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            landing: '/early-birds/home',
        });
    });

    it('fails closed without leaking whether a token exists', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({ ok: false, reason: 'unavailable' });
        const response = await POST(request());
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: 'Invitation unavailable.' });
    });
});
