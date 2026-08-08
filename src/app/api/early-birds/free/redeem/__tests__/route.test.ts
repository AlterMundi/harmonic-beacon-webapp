import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
    EARLY_BIRD_INVITATION_COOKIE,
    LISTENER_INVITATION_COOKIE,
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

function request(
    token: string | null = TOKEN,
    namespace: 'legacy' | 'canonical' = 'legacy',
    origin = 'https://listen.harmonicbeacon.com',
    hostname = 'listen.harmonicbeacon.com',
    cookieHeader?: string,
) {
    const headers = new Headers();
    if (cookieHeader) headers.set('cookie', cookieHeader);
    else if (token) headers.set('cookie', `${EARLY_BIRD_INVITATION_COOKIE}=${token}`);
    if (origin) headers.set('origin', origin);
    headers.set('host', hostname);
    headers.set('x-forwarded-proto', 'https');
    const pathname = namespace === 'canonical'
        ? '/api/listener/free/redeem'
        : '/api/early-birds/free/redeem';
    return new NextRequest(`https://${hostname}${pathname}`, {
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
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    });

    it.each([
        [null, 'listen.harmonicbeacon.com'],
        ['https://attacker.invalid', 'listen.harmonicbeacon.com'],
        ['https://listen.harmonicbeacon.com', 'live.harmonicbeacon.com'],
    ])('rejects a missing/cross-origin or off-host mutation before auth: %s %s', async (origin, hostname) => {
        const response = await POST(request(TOKEN, 'canonical', origin ?? '', hostname));

        expect(response.status).toBe(403);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
    });

    it('rejects a direct plaintext request even when Host and Origin match', async () => {
        const response = await POST(new NextRequest(
            'http://listen.harmonicbeacon.com/api/listener/free/redeem',
            {
                method: 'POST',
                headers: {
                    origin: 'http://listen.harmonicbeacon.com',
                    host: 'listen.harmonicbeacon.com',
                    cookie: `${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
                },
            },
        ));

        expect(response.status).toBe(403);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
    });

    it('rejects the exact staging host because redemption belongs to the canonical session origin', async () => {
        const response = await POST(request(
            TOKEN,
            'canonical',
            'https://earlybirds-staging.harmonicbeacon.com',
            'earlybirds-staging.harmonicbeacon.com',
        ));

        expect(response.status).toBe(403);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
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
        expect(response.cookies.get(LISTENER_INVITATION_COOKIE)).toMatchObject({
            value: '',
            maxAge: 0,
            path: '/',
        });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    });

    it('redeems a canonical-only cookie during the compatibility window', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({
            ok: true,
            replayed: false,
            alreadyEntitled: false,
        });
        const response = await POST(request(
            TOKEN,
            'canonical',
            undefined,
            undefined,
            `${LISTENER_INVITATION_COOKIE}=${TOKEN}`,
        ));

        expect(response.status).toBe(200);
        expect(redeemFreeThroughCanonicalGateway).toHaveBeenCalledWith('listener-1', TOKEN);
    });

    it('fails closed and clears both generations when dual cookies conflict', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        const other = `ebi_v1.${'d'.repeat(32)}.${'e'.repeat(32)}.${'f'.repeat(32)}`;
        const response = await POST(request(
            TOKEN,
            'canonical',
            undefined,
            undefined,
            `${LISTENER_INVITATION_COOKIE}=${other}; ${EARLY_BIRD_INVITATION_COOKIE}=${TOKEN}`,
        ));

        expect(response.status).toBe(409);
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
        expect(response.cookies.get(LISTENER_INVITATION_COOKIE)?.maxAge).toBe(0);
        expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)?.maxAge).toBe(0);
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
            'https://listen.harmonicbeacon.com/api/early-birds/free/redeem',
            {
                method: 'POST',
                headers: {
                    origin: 'https://listen.harmonicbeacon.com',
                    host: 'listen.harmonicbeacon.com',
                    'x-forwarded-proto': 'https',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ token: TOKEN }),
            },
        ));

        expect(response.status).toBe(409);
        expect(redeemFreeThroughCanonicalGateway).not.toHaveBeenCalled();
    });

    it('clears a terminally rejected token without leaking cross-account use or revocation', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockResolvedValue({ ok: false, reason: 'unavailable' });
        const response = await POST(request());
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: 'Invitation unavailable.' });
        expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toMatchObject({
            value: '',
            maxAge: 0,
        });
        expect(response.cookies.get(LISTENER_INVITATION_COOKIE)).toMatchObject({
            value: '',
            maxAge: 0,
        });
    });

    it('retains the short invitation cookie when the canonical authority is unavailable', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        redeemFreeThroughCanonicalGateway.mockRejectedValue(new Error('timeout'));

        const response = await POST(request());

        expect(response.status).toBe(503);
        expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toBeUndefined();
        expect(response.cookies.get(LISTENER_INVITATION_COOKIE)).toBeUndefined();
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    });
});
