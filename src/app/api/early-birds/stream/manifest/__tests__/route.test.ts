import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    authorizeEarlyBirdStreamLease: vi.fn(),
    earlyBirdOriginConfig: vi.fn(),
    signedEarlyBirdOriginManifestUrl: vi.fn(),
    validSignedOriginManifest: vi.fn(),
    LeaseInactive: class extends Error {
        constructor(readonly reason: 'evicted' | 'expired' | 'missing' = 'missing') {
            super('inactive');
        }
    },
    AccessDenied: class extends Error {},
}));

const {
    currentEarlyBirdSession,
    authorizeEarlyBirdStreamLease,
    earlyBirdOriginConfig,
    signedEarlyBirdOriginManifestUrl,
    validSignedOriginManifest,
    LeaseInactive,
} = mocks;

vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/stream', () => ({
    authorizeEarlyBirdStreamLease: mocks.authorizeEarlyBirdStreamLease,
    earlyBirdOriginConfig: mocks.earlyBirdOriginConfig,
    signedEarlyBirdOriginManifestUrl: mocks.signedEarlyBirdOriginManifestUrl,
    validSignedOriginManifest: mocks.validSignedOriginManifest,
    EarlyBirdLeaseInactiveError: mocks.LeaseInactive,
    EarlyBirdAccessDeniedError: mocks.AccessDenied,
}));

import { GET } from '../route';

const LEASE_ID = '00000000-0000-4000-8000-000000000003';

function request() {
    return new NextRequest(`https://live.example.test/api/early-birds/stream/manifest?leaseId=${LEASE_ID}`);
}

beforeEach(() => vi.stubEnv('EARLY_BIRDS_ENABLED', '1'));
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('stable EarlyBird lease manifest', () => {
    it('does not contact the origin before auth and lease authorization', async () => {
        currentEarlyBirdSession.mockResolvedValue(null);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await GET(request());
        expect(response.status).toBe(401);
        expect(authorizeEarlyBirdStreamLease).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('proxies only a validated signed-segment manifest with no-store', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        authorizeEarlyBirdStreamLease.mockResolvedValue({
            id: LEASE_ID,
            expiresAt: new Date(Date.now() + 120_000),
        });
        earlyBirdOriginConfig.mockReturnValue({ origin: 'https://stream.example.test' });
        signedEarlyBirdOriginManifestUrl.mockReturnValue('https://stream.example.test/live.m3u8?exp=1&sig=secret-url');
        validSignedOriginManifest.mockReturnValue(true);
        const manifest = '#EXTM3U\nhttps://stream.example.test/segment?exp=2&sig=x\n';
        const fetchMock = vi.fn().mockResolvedValue(new Response(manifest, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await GET(request());
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(response.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');
        await expect(response.text()).resolves.toBe(manifest);
        expect(authorizeEarlyBirdStreamLease).toHaveBeenCalledWith('listener-1', LEASE_ID, expect.any(Date));
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('cuts off a displaced device on its next manifest refresh', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        authorizeEarlyBirdStreamLease.mockRejectedValue(new LeaseInactive('evicted'));
        const response = await GET(request());
        expect(response.status).toBe(410);
        expect(response.headers.get('cache-control')).toContain('no-store');
        await expect(response.json()).resolves.toMatchObject({ reason: 'displaced' });
    });

    it('reports ordinary lease expiry without claiming another device displaced it', async () => {
        currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        authorizeEarlyBirdStreamLease.mockRejectedValue(new LeaseInactive('expired'));
        const response = await GET(request());
        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toEqual({
            error: 'Listening lease expired.',
            reason: 'expired',
        });
    });
});
