import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyzer = vi.hoisted(() => ({ frameAt: vi.fn() }));
const routeState = vi.hoisted(() => ({
    enabled: true,
    freeForAll: false,
    session: { user: { id: 'account-1' } } as { user: { id: string } } | null,
    authorize: vi.fn(),
    authorizeFreeForAll: vi.fn(),
}));

vi.mock('@/lib/listener/analysis/server-harmonic-analyzer', () => ({
    listenerServerHarmonicAnalyzer: () => analyzer,
    serializeServerHarmonicFrame: (frame: unknown) => frame,
}));
vi.mock('@/lib/early-birds/auth', () => ({
    currentEarlyBirdSession: () => Promise.resolve(routeState.session),
}));
vi.mock('@/lib/early-birds/enabled', () => ({
    earlyBirdsEnabled: () => routeState.enabled,
    earlyBirdsFreeForAll: () => routeState.freeForAll,
}));
vi.mock('@/lib/early-birds/stream', () => ({
    authorizeEarlyBirdStreamLease: (...args: unknown[]) => routeState.authorize(...args),
    authorizeFreeForAllStreamLease: (...args: unknown[]) => routeState.authorizeFreeForAll(...args),
}));

import { GET } from '../route';

function request(host: string, at = Date.now()) {
    return new Request(
        `https://${host}/api/listener/analysis/frame?at=${at}`
            + '&leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=7', {
        headers: { host },
        },
    );
}

describe('GET /api/listener/analysis/frame', () => {
    beforeEach(() => {
        routeState.enabled = true;
        routeState.freeForAll = false;
        routeState.session = { user: { id: 'account-1' } };
        routeState.authorize.mockReset().mockResolvedValue({});
        routeState.authorizeFreeForAll.mockReset().mockResolvedValue({});
        analyzer.frameAt.mockReset().mockResolvedValue({
            schemaVersion: 1,
            capturedAtMs: Date.now(),
            sourceTimeSeconds: 1,
            overallDb: -18,
            harmonicAbsoluteDb: [-10],
            harmonicDeltaDb: [0],
            spectralEnvelopeDb: [-10],
            stereoBalance: 0,
            stereoWidth: 0,
            confidence: 1,
            sourceKind: 'beacon',
        });
    });

    it('serves no-store frames only on the exact Listener hosts', async () => {
        const response = await GET(request('earlybirds-staging.harmonicbeacon.com'));
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('X-Listener-Analysis-Source')).toBe('server');
        expect(routeState.authorize).toHaveBeenCalledWith(
            'account-1',
            '00000000-0000-4000-8000-000000000003',
            7,
        );
        expect(analyzer.frameAt).toHaveBeenCalledOnce();

        expect((await GET(request('listen.harmonicbeacon.com'))).status).toBe(200);

        for (const host of [
            'live.harmonicbeacon.com',
            'earlybirds-staging.harmonicbeacon.com.evil.test',
        ]) {
            const rejected = await GET(request(host));
            expect(rejected.status).toBe(404);
        }
    });

    it('rejects stale program times before decoding', async () => {
        expect((await GET(request(
            'earlybirds-staging.harmonicbeacon.com',
            Date.now() - 3 * 60_000,
        ))).status).toBe(200);
        analyzer.frameAt.mockClear();
        const response = await GET(request(
            'earlybirds-staging.harmonicbeacon.com',
            Date.now() - 10 * 60_000,
        ));
        expect(response.status).toBe(400);
        expect(analyzer.frameAt).not.toHaveBeenCalled();
    });

    it('requires a valid listening lease and supports the existing FFA authority', async () => {
        routeState.session = null;
        expect((await GET(request('earlybirds-staging.harmonicbeacon.com'))).status).toBe(401);
        expect(analyzer.frameAt).not.toHaveBeenCalled();

        routeState.freeForAll = true;
        const response = await GET(request('earlybirds-staging.harmonicbeacon.com'));
        expect(response.status).toBe(200);
        expect(routeState.authorizeFreeForAll).toHaveBeenCalledWith(
            '00000000-0000-4000-8000-000000000003',
            7,
        );
    });

    it('fails the visual endpoint softly without leaking decoder details', async () => {
        analyzer.frameAt.mockRejectedValueOnce(new Error('/media/private/segment.m4s'));
        const response = await GET(request('earlybirds-staging.harmonicbeacon.com'));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'analysis_unavailable' });
    });

    it('rejects an inactive lease without invoking the decoder', async () => {
        routeState.authorize.mockRejectedValueOnce(new Error('expired lease internals'));
        const response = await GET(request('earlybirds-staging.harmonicbeacon.com'));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'listening_lease_inactive' });
        expect(analyzer.frameAt).not.toHaveBeenCalled();
    });
});
