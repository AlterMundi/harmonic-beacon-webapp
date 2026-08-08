import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdListeningAccess: vi.fn(),
    stat: vi.fn(),
    open: vi.fn(),
    createReadStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ stat: mocks.stat, open: mocks.open }));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/access', () => ({
    getEarlyBirdListeningAccess: mocks.getEarlyBirdListeningAccess,
}));

import { GET, HEAD } from '../route';

const context = (language: string) => ({ params: Promise.resolve({ language }) });

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    vi.stubEnv('EARLY_BIRDS_DROPIN_ES_PATH', '/media/drop-ins/amara.m4a');
    mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
    mocks.getEarlyBirdListeningAccess.mockResolvedValue({ allowed: true });
    mocks.stat.mockResolvedValue({ size: 10, isFile: () => true });
    mocks.createReadStream.mockImplementation(({ start, end }: { start: number; end: number }) => (
        Readable.from([Buffer.from('0123456789').subarray(start, end + 1)])
    ));
    mocks.open.mockResolvedValue({ createReadStream: mocks.createReadStream });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('private EarlyBird drop-in media', () => {
    it('requires an entitled Listener before reading media', async () => {
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/es'), context('es'))).status).toBe(401);
        expect(mocks.stat).not.toHaveBeenCalled();
        expect(mocks.open).not.toHaveBeenCalled();

        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        mocks.getEarlyBirdListeningAccess.mockResolvedValue({ allowed: false });
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/es'), context('es'))).status).toBe(403);
        expect(mocks.stat).not.toHaveBeenCalled();
        expect(mocks.open).not.toHaveBeenCalled();
    });

    it('serves the configured drop-in anonymously only in Free for All mode', async () => {
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        mocks.currentEarlyBirdSession.mockResolvedValue(null);

        const response = await GET(
            new NextRequest('https://listener.test/api/early-birds/drop-ins/es'),
            context('es'),
        );

        expect(response.status).toBe(200);
        expect(mocks.currentEarlyBirdSession).not.toHaveBeenCalled();
        expect(mocks.getEarlyBirdListeningAccess).not.toHaveBeenCalled();
    });

    it('streams only the selected byte range from an immutable server-selected path', async () => {
        const request = new NextRequest('https://listener.test/api/early-birds/drop-ins/es', {
            headers: { range: 'bytes=2-5' },
        });
        const response = await GET(request, context('es'));
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
        expect(response.headers.get('content-type')).toBe('audio/mp4');
        await expect(response.text()).resolves.toBe('2345');
        expect(mocks.stat).toHaveBeenCalledWith('/media/drop-ins/amara.m4a');
        expect(mocks.open).toHaveBeenCalledWith('/media/drop-ins/amara.m4a', 'r');
        expect(mocks.createReadStream).toHaveBeenCalledWith({ start: 2, end: 5, autoClose: true });
    });

    it('answers HEAD from metadata without opening or reading the media', async () => {
        const request = new NextRequest('https://listener.test/api/early-birds/drop-ins/es');
        const head = await HEAD(new NextRequest(request.url), context('es'));
        expect(head.status).toBe(200);
        expect(head.headers.get('content-length')).toBe('10');
        await expect(head.text()).resolves.toBe('');
        expect(mocks.stat).toHaveBeenCalledWith('/media/drop-ins/amara.m4a');
        expect(mocks.open).not.toHaveBeenCalled();
        expect(mocks.createReadStream).not.toHaveBeenCalled();
    });

    it('streams a full GET without buffering the complete file in the route', async () => {
        const response = await GET(
            new NextRequest('https://listener.test/api/early-birds/drop-ins/es'),
            context('es'),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-length')).toBe('10');
        await expect(response.text()).resolves.toBe('0123456789');
        expect(mocks.createReadStream).toHaveBeenCalledWith({ start: 0, end: 9, autoClose: true });
    });

    it('fails closed for unknown languages, invalid paths and ranges', async () => {
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/fr'), context('fr'))).status).toBe(404);
        vi.stubEnv('EARLY_BIRDS_DROPIN_ES_PATH', 'relative.m4a');
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/es'), context('es'))).status).toBe(404);
        vi.stubEnv('EARLY_BIRDS_DROPIN_ES_PATH', '/media/drop-ins/amara.m4a');
        const invalid = new NextRequest('https://listener.test/api/early-birds/drop-ins/es', {
            headers: { range: 'bytes=99-' },
        });
        expect((await GET(invalid, context('es'))).status).toBe(416);
    });

    it('fails closed when media metadata or file opening is unavailable', async () => {
        mocks.stat.mockRejectedValueOnce(new Error('missing'));
        expect((await GET(
            new NextRequest('https://listener.test/api/early-birds/drop-ins/es'),
            context('es'),
        )).status).toBe(404);

        mocks.open.mockRejectedValueOnce(new Error('permission denied'));
        expect((await GET(
            new NextRequest('https://listener.test/api/early-birds/drop-ins/es'),
            context('es'),
        )).status).toBe(404);
    });
});
