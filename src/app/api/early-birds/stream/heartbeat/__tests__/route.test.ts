import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    heartbeatEarlyBirdStreamLease: vi.fn(),
    LeaseInactive: class extends Error {
        constructor(readonly reason: 'evicted' | 'expired' | 'missing' = 'missing') {
            super('inactive');
        }
    },
    AccessDenied: class extends Error {},
}));

vi.mock('@/lib/early-birds/auth', () => ({
    currentEarlyBirdSession: mocks.currentEarlyBirdSession,
}));
vi.mock('@/lib/early-birds/stream', () => ({
    heartbeatEarlyBirdStreamLease: mocks.heartbeatEarlyBirdStreamLease,
    EarlyBirdLeaseInactiveError: mocks.LeaseInactive,
    EarlyBirdAccessDeniedError: mocks.AccessDenied,
}));

import { POST } from '../route';

const LEASE_ID = '00000000-0000-4000-8000-000000000003';

function request(intent?: 'play' | 'prepare') {
    return new NextRequest('https://listener.example.test/api/early-birds/stream/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaseId: LEASE_ID, intent }),
    });
}

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('EarlyBird stream heartbeat route', () => {
    it('distinguishes a real eviction from ordinary expiry', async () => {
        mocks.heartbeatEarlyBirdStreamLease
            .mockRejectedValueOnce(new mocks.LeaseInactive('evicted'))
            .mockRejectedValueOnce(new mocks.LeaseInactive('expired'));

        const displaced = await POST(request());
        expect(displaced.status).toBe(410);
        await expect(displaced.json()).resolves.toEqual({
            error: 'Device displaced.',
            reason: 'displaced',
        });

        const expired = await POST(request());
        expect(expired.status).toBe(410);
        await expect(expired.json()).resolves.toEqual({
            error: 'Listening lease expired.',
            reason: 'expired',
        });
    });

    it('returns a renewed same-origin grant for an active lease', async () => {
        mocks.heartbeatEarlyBirdStreamLease.mockResolvedValue({
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            stream: {
                manifestUrl: `/api/early-birds/stream/manifest?leaseId=${LEASE_ID}`,
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });
        const response = await POST(request());
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            stream: { manifestUrl: `/api/early-birds/stream/manifest?leaseId=${LEASE_ID}` },
        });
        expect(mocks.heartbeatEarlyBirdStreamLease).toHaveBeenCalledWith(
            'listener-1', LEASE_ID, undefined, undefined, true,
        );
    });

    it('renews a prepared source without promoting its eviction priority', async () => {
        mocks.heartbeatEarlyBirdStreamLease.mockResolvedValue({
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            stream: {
                manifestUrl: `/api/early-birds/stream/manifest?leaseId=${LEASE_ID}`,
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });

        expect((await POST(request('prepare'))).status).toBe(200);
        expect(mocks.heartbeatEarlyBirdStreamLease).toHaveBeenCalledWith(
            'listener-1', LEASE_ID, undefined, undefined, false,
        );
    });
});
