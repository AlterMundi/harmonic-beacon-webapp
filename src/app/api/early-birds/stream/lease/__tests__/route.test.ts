import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const acquireEarlyBirdStreamLease = vi.hoisted(() => vi.fn());
const acquireFreeForAllStreamLease = vi.hoisted(() => vi.fn());
const prepareEarlyBirdStreamLease = vi.hoisted(() => vi.fn());
const claimEarlyBirdStreamLease = vi.hoisted(() => vi.fn());
const EarlyBirdDeviceCapacityError = vi.hoisted(() => class extends Error {});

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/stream', () => ({
    acquireEarlyBirdStreamLease,
    acquireFreeForAllStreamLease,
    prepareEarlyBirdStreamLease,
    claimEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError: class extends Error {},
    EarlyBirdDeviceCapacityError,
    EarlyBirdStreamIssuerUnavailableError: class extends Error {},
}));

import { POST } from '../route';

function request(deviceId = 'device_abcdefghijklmnopqrstuvwxyz', intent?: 'play' | 'prepare' | 'claim') {
    return new NextRequest('https://live.example.test/api/early-birds/stream/lease', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, intent }),
    });
}

beforeEach(() => vi.stubEnv('EARLY_BIRDS_ENABLED', '1'));
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('EarlyBird stream lease route', () => {
    it('requires an EarlyBird session independent from weekend auth', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(acquireEarlyBirdStreamLease).not.toHaveBeenCalled();
    });

    it('issues an anonymous public lease only while Free for All is explicit', async () => {
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        currentEarlyBirdSession.mockResolvedValue(null);
        acquireFreeForAllStreamLease.mockResolvedValue({
            serverNow: new Date('2026-08-06T12:00:00.000Z'),
            accessKind: 'free-for-all',
            quota: null,
            leaseGeneration: 1,
            presenceSequence: 0,
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            evictedLeaseId: null,
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(acquireFreeForAllStreamLease).toHaveBeenCalledWith('device_abcdefghijklmnopqrstuvwxyz');
        expect(currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(acquireEarlyBirdStreamLease).not.toHaveBeenCalled();
    });

    it('returns only the stable same-origin manifest grant', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        acquireEarlyBirdStreamLease.mockResolvedValue({
            serverNow: new Date('2026-08-06T12:00:00.000Z'),
            accessKind: 'free-quota',
            quota: { policy: 'personal-7-day-v1', status: 'available' },
            leaseGeneration: 2,
            presenceSequence: 0,
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            evictedLeaseId: '00000000-0000-4000-8000-000000000001',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });
        const response = await POST(request());
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.evictedAnotherDevice).toBe(true);
        expect(body.stream.manifestUrl).toMatch(/^\/api\/early-birds\/stream\/manifest/);
        expect(JSON.stringify(body)).not.toContain('sig=');
    });

    it('prepares playback without using the eviction-capable lease path', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        prepareEarlyBirdStreamLease.mockResolvedValue({
            serverNow: new Date('2026-08-06T12:00:00.000Z'),
            accessKind: 'free-quota',
            quota: { policy: 'personal-7-day-v1', status: 'not-started' },
            leaseGeneration: 3,
            presenceSequence: 0,
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            evictedLeaseId: null,
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });

        const response = await POST(request('device_abcdefghijklmnopqrstuvwxyz', 'prepare'));

        expect(response.status).toBe(200);
        expect(prepareEarlyBirdStreamLease).toHaveBeenCalledWith(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
        );
        expect(acquireEarlyBirdStreamLease).not.toHaveBeenCalled();
    });

    it('claims eviction priority while preserving IDLE/unmetered semantics in the core', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        claimEarlyBirdStreamLease.mockResolvedValue({
            serverNow: new Date('2026-08-06T12:00:00.000Z'),
            accessKind: 'free-quota',
            quota: { policy: 'personal-7-day-v1', status: 'not-started' },
            leaseGeneration: 4,
            presenceSequence: 0,
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: new Date('2026-08-06T12:03:00.000Z'),
            evictedLeaseId: '00000000-0000-4000-8000-000000000001',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=4',
                expiresAt: new Date('2026-08-06T12:03:00.000Z'),
            },
        });
        const response = await POST(request('device_abcdefghijklmnopqrstuvwxyz', 'claim'));
        expect(response.status).toBe(200);
        expect(claimEarlyBirdStreamLease).toHaveBeenCalledWith(
            'listener-1', 'device_abcdefghijklmnopqrstuvwxyz',
        );
        await expect(response.json()).resolves.toMatchObject({
            leaseGeneration: 4,
            presenceSequence: 0,
            evictedAnotherDevice: true,
        });
    });

    it('reports device capacity instead of evicting during preparation', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        prepareEarlyBirdStreamLease.mockRejectedValue(new EarlyBirdDeviceCapacityError());

        const response = await POST(request('device_abcdefghijklmnopqrstuvwxyz', 'prepare'));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ reason: 'device_limit' });
        expect(acquireEarlyBirdStreamLease).not.toHaveBeenCalled();
    });
});
