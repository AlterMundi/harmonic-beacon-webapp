import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const createCheckout = vi.hoisted(() => vi.fn());

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/checkout', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/early-birds/checkout')>();
    return {
        ...actual,
        HttpListenerCheckoutGateway: class {
            create = createCheckout;
        },
    };
});

import { POST } from '../route';

const HOST = 'earlybirds-staging.harmonicbeacon.com';
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';

function request(
    body: unknown = { provider: 'paypal', attemptId: ATTEMPT },
    origin = `https://${HOST}`,
    host = HOST,
) {
    const serialized = JSON.stringify(body);
    return new NextRequest(`https://${host}/api/listener/checkout`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'content-length': String(new TextEncoder().encode(serialized).byteLength),
            host,
            origin,
            'x-forwarded-proto': 'https',
        },
        body: serialized,
    });
}

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    vi.stubEnv('BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED', '1');
    vi.stubEnv('BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED', '1');
    vi.stubEnv('BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED', '0');
    vi.stubEnv('BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED', '0');
    currentEarlyBirdSession.mockResolvedValue({
        user: { id: 'opaqueBetterAuthId', email: 'listener@example.com', name: 'Listener' },
    });
    createCheckout.mockResolvedValue({
        provider: 'paypal',
        approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=test',
    });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('Listener sandbox checkout route', () => {
    it('derives account, email and callbacks from the session and exact staging origin', async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        await expect(response.json()).resolves.toEqual({
            provider: 'paypal',
            approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=test',
        });
        expect(createCheckout).toHaveBeenCalledWith({
            accountId: 'opaqueBetterAuthId',
            email: 'listener@example.com',
            provider: 'paypal',
            attemptId: ATTEMPT,
            returnUrl: `https://${HOST}/?checkout=returned`,
            cancelUrl: `https://${HOST}/?checkout=cancelled`,
            environment: 'staging',
        });
    });

    it('allows an explicitly enabled Live checkout only on the canonical Listener origin', async () => {
        vi.stubEnv('BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED', '1');
        createCheckout.mockResolvedValue({
            provider: 'paypal',
            approvalUrl: 'https://www.paypal.com/checkoutnow?token=live',
        });
        const host = 'listen.harmonicbeacon.com';
        const response = await POST(request(undefined, `https://${host}`, host));
        expect(response.status).toBe(200);
        expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
            accountId: 'opaqueBetterAuthId',
            provider: 'paypal',
            environment: 'live',
            returnUrl: `https://${host}/?checkout=returned`,
            cancelUrl: `https://${host}/?checkout=cancelled`,
        }));
    });

    it('keeps canonical Live checkout closed when only sandbox providers are enabled', async () => {
        const host = 'listen.harmonicbeacon.com';
        const response = await POST(request(undefined, `https://${host}`, host));
        expect(response.status).toBe(404);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it.each([
        ['event host', 'https://live.harmonicbeacon.com', 'live.harmonicbeacon.com'],
        ['cross origin', 'https://attacker.invalid', HOST],
    ])('rejects %s before auth', async (_label, origin, host) => {
        const response = await POST(request(undefined, origin, host));
        expect(response.status).toBe(403);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests without contacting the authority', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it.each([
        ['paypal', 'BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED'],
        ['mercado_pago', 'BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED'],
    ] as const)('fails closed when %s is disabled', async (provider, variable) => {
        vi.stubEnv(variable, '0');
        const response = await POST(request({ provider, attemptId: ATTEMPT }));
        expect(response.status).toBe(404);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it.each([
        [{ provider: 'paypal', attemptId: 'not-a-uuid' }, 400],
        [{ provider: 'stripe', attemptId: ATTEMPT }, 400],
        [{ provider: 'paypal', attemptId: ATTEMPT, email: 'attacker@example.com' }, 400],
    ])('rejects malformed or client-supplied identity input', async (body, status) => {
        const response = await POST(request(body));
        expect(response.status).toBe(status);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it('returns a generic error without exposing authority details', async () => {
        createCheckout.mockRejectedValue(new Error('provider payload contained PII'));
        const response = await POST(request());
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Checkout unavailable.' });
    });
});
