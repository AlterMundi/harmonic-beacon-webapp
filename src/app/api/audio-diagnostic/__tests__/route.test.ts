import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest } from '@/__tests__/helpers';

const readFile = vi.fn();
const resolveRoomPrincipal = vi.fn();

vi.mock('node:fs/promises', () => ({ readFile }));
vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));

describe('GET /api/audio-diagnostic', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env.E2E_DASHBOARD_ENABLED = '1';
        process.env.BEACON_REFERENCE_AUDIO_PATH = '/data/reference.ogg';
        resolveRoomPrincipal.mockResolvedValue({ ok: true, principal: {} });
        readFile.mockResolvedValue(Buffer.from('0123456789'));
    });

    afterEach(() => {
        delete process.env.E2E_DASHBOARD_ENABLED;
        delete process.env.BEACON_REFERENCE_AUDIO_PATH;
    });

    it('serves the exact authenticated reference OGG with private no-store headers', async () => {
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/audio-diagnostic?sessionId=session-1'));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/ogg');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('0123456789');
        expect(readFile).toHaveBeenCalledWith('/data/reference.ogg');
    });

    it('supports browser byte-range requests', async () => {
        const { GET } = await import('../route');
        const response = await GET(createRequest(
            '/api/audio-diagnostic?sessionId=session-1',
            { headers: { range: 'bytes=2-5' } },
        ));

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('2345');
    });

    it('looks absent when the temporary test gate is disabled', async () => {
        delete process.env.E2E_DASHBOARD_ENABLED;
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/audio-diagnostic?sessionId=session-1'));

        expect(response.status).toBe(404);
        expect(resolveRoomPrincipal).not.toHaveBeenCalled();
        expect(readFile).not.toHaveBeenCalled();
    });
});
