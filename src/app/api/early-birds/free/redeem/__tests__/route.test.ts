import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const redeemFreeThroughCanonicalGateway = vi.hoisted(() => vi.fn());

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/membership-gateway', () => ({
    EarlyBirdMembershipGatewayUnavailableError: class extends Error {},
    redeemFreeThroughCanonicalGateway,
}));

import { POST } from '../route';

const TOKEN = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

function request(token: string | null = TOKEN, namespace: 'legacy' | 'canonical' = 'legacy') {
    const headers = new Headers();
    if (token) headers.set('cookie', `${EARLY_BIRD_INVITATION_COOKIE}=${token}`);
    const pathname = namespace === 'canonical'
        ? '/api/listener/free/redeem'
        : '/api/early-birds/free/redeem';
    return new NextRequest(`https://live.example.test${pathname}`, {
        method: 'POST',
        headers,
    });
}

beforeEach(() => vi.stubEnv('EARLY_BIRDS_ENABLED', '1'));
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('EarlyBird Free redemption boundary', () => {
    it('stops before auth and canonical membership while public entry is disabled', async () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '0');
        const response = await POST(request());

        expect(response.status).toBe(503);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

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
        const token = TOKEN;
        const response = await POST(request(token));
        expect(response.status).toBe(200);
        expect(redeemFreeThroughCanonicalGateway).toHaveBeenCalledWith('listener-1', token);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            landing: '/early-birds',
        });
        expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toMatchObject({
            value: '',
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
    });

    it('returns the canonical landing only to the canonical alias', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({
            ok: true,
            replayed: true,
            alreadyEntitled: true,
        });

        const canonical = await POST(request(TOKEN, 'canonical'));
        await expect(canonical.json()).resolves.toMatchObject({ landing: '/listener' });

        const legacy = await POST(request(TOKEN, 'legacy'));
        await expect(legacy.json()).resolves.toMatchObject({ landing: '/early-birds' });
    });

    it('does not accept an invitation token from a request body', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        const response = await POST(new NextRequest(
            'https://live.example.test/api/early-birds/free/redeem',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: TOKEN }),
            },
        ));

        expect(response.status).toBe(409);
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
    });

    it('fails closed without leaking whether a token exists', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({ ok: false, reason: 'unavailable' });
        const response = await POST(request());
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: 'Invitation unavailable.' });
    });
});
