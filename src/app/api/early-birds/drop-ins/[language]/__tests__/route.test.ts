import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    currentEarlyBirdSession: vi.fn(),
    getEarlyBirdAccess: vi.fn(),
    readFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/early-birds/membership', () => ({ getEarlyBirdAccess: mocks.getEarlyBirdAccess }));

import { GET, HEAD } from '../route';

const context = (language: string) => ({ params: Promise.resolve({ language }) });

beforeEach(() => {
    vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
    vi.stubEnv('EARLY_BIRDS_DROPIN_ES_PATH', '/media/drop-ins/amara.m4a');
    mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
    mocks.getEarlyBirdAccess.mockResolvedValue({ allowed: true });
    mocks.readFile.mockResolvedValue(Buffer.from('0123456789'));
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('private EarlyBird drop-in media', () => {
    it('requires an entitled Listener before reading media', async () => {
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/es'), context('es'))).status).toBe(401);
        expect(mocks.readFile).not.toHaveBeenCalled();

        mocks.currentEarlyBirdSession.mockResolvedValue({ user: { id: 'listener-1' } });
        mocks.getEarlyBirdAccess.mockResolvedValue({ allowed: false });
        expect((await GET(new NextRequest('https://listener.test/api/early-birds/drop-ins/es'), context('es'))).status).toBe(403);
        expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('serves byte ranges and HEAD with immutable server-selected paths', async () => {
        const request = new NextRequest('https://listener.test/api/early-birds/drop-ins/es', {
            headers: { range: 'bytes=2-5' },
        });
        const response = await GET(request, context('es'));
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
        expect(response.headers.get('content-type')).toBe('audio/mp4');
        await expect(response.text()).resolves.toBe('2345');
        expect(mocks.readFile).toHaveBeenCalledWith('/media/drop-ins/amara.m4a');

        const head = await HEAD(new NextRequest(request.url), context('es'));
        expect(head.status).toBe(200);
        expect(head.headers.get('content-length')).toBe('10');
        await expect(head.text()).resolves.toBe('');
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
});
