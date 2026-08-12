import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const requestAction = vi.hoisted(() => vi.fn());
const getEarlyBirdListeningAccess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/access', () => ({ getEarlyBirdListeningAccess }));
vi.mock('@/lib/early-birds/membership-actions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/early-birds/membership-actions')>();
    return {
        ...actual,
        HttpListenerMembershipActionsGateway: class {
            requestAction = requestAction;
        },
    };
});

import { POST } from '../route';

const HOST = 'listen.harmonicbeacon.com';
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';

function request(
    body: unknown = { action: 'cancel', attemptId: ATTEMPT },
    host = HOST,
    origin = `https://${HOST}`,
) {
    const serialized = JSON.stringify(body);
    return new NextRequest(`https://${host}/api/listener/membership/action`, {
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
    currentEarlyBirdSession.mockResolvedValue({
        user: { id: 'opaqueBetterAuthId', email: 'listener@example.com', name: 'Listener' },
    });
    requestAction.mockResolvedValue(undefined);
    getEarlyBirdListeningAccess.mockResolvedValue({
        membership: { projection: { source: 'PAYPAL' } },
    });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('Listener membership action route', () => {
    it.each(['cancel', 'reactivate'] as const)(
        'derives the account for %s and returns no provider identifiers',
        async (action) => {
            const response = await POST(request({ action, attemptId: ATTEMPT }));
            expect(response.status).toBe(202);
            await expect(response.json()).resolves.toEqual({ status: 'queued' });
            expect(requestAction).toHaveBeenCalledWith({
                accountId: 'opaqueBetterAuthId',
                attemptId: ATTEMPT,
                action,
                environment: 'live',
                provider: null,
            });
        },
    );

    it('uses only the canonical staging projection to select a sandbox provider', async () => {
        const host = 'earlybirds-staging.harmonicbeacon.com';
        const response = await POST(request(
            { action: 'reactivate', attemptId: ATTEMPT },
            host,
            `https://${host}`,
        ));
        expect(response.status).toBe(202);
        expect(requestAction).toHaveBeenCalledWith({
            accountId: 'opaqueBetterAuthId',
            attemptId: ATTEMPT,
            action: 'reactivate',
            environment: 'staging',
            provider: 'paypal',
        });
    });

    it.each([
        ['event host', 'live.harmonicbeacon.com', 'https://live.harmonicbeacon.com'],
        ['cross origin', HOST, 'https://attacker.invalid'],
    ])('rejects %s before session lookup', async (_label, host, origin) => {
        const response = await POST(request(undefined, host, origin));
        expect(response.status).toBe(403);
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(requestAction).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated, unknown actions and client-supplied fields', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        expect((await POST(request())).status).toBe(401);
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'opaqueBetterAuthId' } });
        expect((await POST(request({ action: 'resume', attemptId: ATTEMPT }))).status).toBe(400);
        expect((await POST(request({ action: 'cancel', attemptId: ATTEMPT, provider: 'paypal' }))).status).toBe(400);
        expect(requestAction).not.toHaveBeenCalled();
    });

    it('returns a generic failure without changing browser authority', async () => {
        requestAction.mockRejectedValue(new Error('provider leaked a subscription id'));
        const response = await POST(request());
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Membership unavailable.' });
    });
});
