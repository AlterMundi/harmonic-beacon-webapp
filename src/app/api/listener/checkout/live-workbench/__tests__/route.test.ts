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

import {
    LISTENER_LIVE_WORKBENCH_CSRF_HEADER,
    createListenerLiveWorkbenchCsrfToken,
    listenerLiveWorkbenchConfig,
} from '@/lib/early-birds/live-workbench';
import { POST } from '../route';

const HOST = 'earlybirds-staging.harmonicbeacon.com';
const ORIGIN = `https://${HOST}`;
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT_ID = 'opaque-account_1';
const SESSION_ID = 'session-1';

function csrfToken(): string {
    return createListenerLiveWorkbenchCsrfToken({
        config: listenerLiveWorkbenchConfig()!,
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
    })!;
}

function request(overrides: {
    body?: unknown;
    host?: string;
    origin?: string;
    protocol?: string;
    fetchSite?: string;
    fetchMode?: string;
    fetchDest?: string;
    csrf?: string | null;
} = {}) {
    const body = JSON.stringify(overrides.body ?? { attemptId: ATTEMPT });
    const host = overrides.host ?? HOST;
    const headers = new Headers({
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(body).byteLength),
        host,
        origin: overrides.origin ?? ORIGIN,
        'x-forwarded-proto': overrides.protocol ?? 'https',
        'sec-fetch-site': overrides.fetchSite ?? 'same-origin',
        'sec-fetch-mode': overrides.fetchMode ?? 'cors',
        'sec-fetch-dest': overrides.fetchDest ?? 'empty',
    });
    const csrf = overrides.csrf === undefined ? csrfToken() : overrides.csrf;
    if (csrf !== null) headers.set(LISTENER_LIVE_WORKBENCH_CSRF_HEADER, csrf);
    return new NextRequest(`https://${host}/api/listener/checkout/live-workbench`, {
        method: 'POST',
        headers,
        body,
    });
}

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED', '1');
    vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID', ACCOUNT_ID);
    vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER', 'paypal');
    vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET', 's'.repeat(43));
    vi.stubEnv('BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED', '0');
    vi.stubEnv('BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED', '0');
    currentEarlyBirdSession.mockResolvedValue({
        user: { id: ACCOUNT_ID, email: 'listener@example.com', name: 'Listener' },
        session: { id: SESSION_ID, expiresAt: new Date('2026-09-01T00:00:00Z') },
    });
    createCheckout.mockResolvedValue({
        provider: 'paypal',
        approvalUrl: 'https://www.paypal.com/checkoutnow?token=live',
    });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('private staging-only Listener Live workbench', () => {
    it('derives account, email and the single provider from server state', async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            provider: 'paypal',
            approvalUrl: 'https://www.paypal.com/checkoutnow?token=live',
        });
        expect(createCheckout).toHaveBeenCalledWith({
            accountId: ACCOUNT_ID,
            email: 'listener@example.com',
            provider: 'paypal',
            attemptId: ATTEMPT,
            returnUrl: `${ORIGIN}/?checkout=returned`,
            cancelUrl: `${ORIGIN}/?checkout=cancelled`,
            environment: 'live',
        });
    });

    it('is absent by default and whenever public Live checkout is enabled', async () => {
        vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED', '0');
        expect((await POST(request({ csrf: null }))).status).toBe(404);

        vi.stubEnv('BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED', '1');
        expect((await POST(request({ csrf: null }))).status).toBe(404);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it.each([
        ['public Listener', { host: 'listen.harmonicbeacon.com', origin: 'https://listen.harmonicbeacon.com', csrf: null }, 404],
        ['event host', { host: 'live.harmonicbeacon.com', origin: 'https://live.harmonicbeacon.com', csrf: null }, 404],
        ['cross origin', { origin: 'https://attacker.invalid', csrf: null }, 403],
        ['plain HTTP', { protocol: 'http', csrf: null }, 403],
        ['cross-site fetch', { fetchSite: 'cross-site', csrf: null }, 403],
        ['navigation fetch', { fetchMode: 'navigate', csrf: null }, 403],
        ['wrong fetch destination', { fetchDest: 'document', csrf: null }, 403],
        ['missing CSRF proof', { csrf: null }, 403],
        ['invalid CSRF proof', { csrf: 'invalid' }, 403],
    ] as const)('rejects %s before checkout', async (_label, overrides, expected) => {
        const response = await POST(request(overrides));
        expect(response.status).toBe(expected);
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it('hides the route from every account except the one server allowlist entry', async () => {
        currentEarlyBirdSession.mockResolvedValue({
            user: { id: 'another-account', email: 'other@example.com', name: 'Other' },
            session: { id: SESSION_ID },
        });
        const response = await POST(request());
        expect(response.status).toBe(404);
        expect(createCheckout).not.toHaveBeenCalled();
    });

    it.each([
        { attemptId: ATTEMPT, provider: 'mercado_pago' },
        { attemptId: ATTEMPT, accountId: ACCOUNT_ID },
        { attemptId: 'not-a-uuid' },
    ])('rejects client attempts to choose authority fields', async (body) => {
        const response = await POST(request({ body }));
        expect(response.status).toBe(400);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
    });
});
