import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const currentEarlyBirdSession = vi.hoisted(() => vi.fn());
const acquireEarlyBirdStreamLease = vi.hoisted(() => vi.fn());

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/stream', () => ({
    acquireEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError: class extends Error {},
    EarlyBirdStreamIssuerUnavailableError: class extends Error {},
}));

import { POST } from '../route';

function request(deviceId = 'device_abcdefghijklmnopqrstuvwxyz') {
    return new NextRequest('https://live.example.test/api/early-birds/stream/lease', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
    });
}

afterEach(() => vi.clearAllMocks());

describe('EarlyBird stream lease route', () => {
    it('requires an EarlyBird session independent from weekend auth', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(acquireEarlyBirdStreamLease).not.toHaveBeenCalled();
    });

    it('returns only the stable same-origin manifest grant', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        acquireEarlyBirdStreamLease.mockResolvedValue({
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
});
