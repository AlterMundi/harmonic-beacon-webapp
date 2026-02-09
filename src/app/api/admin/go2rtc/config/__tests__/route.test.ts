import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/admin/go2rtc/config', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it('returns 401 when x-user-id header is missing', async () => {
        const { GET } = await import('../route');
        const request = createRequest('/api/admin/go2rtc/config');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('proxies to go2rtc and returns config', async () => {
        const mockConfig = {
            streams: {
                'meditation-ocean-waves': { name: 'meditation-ocean-waves' },
            },
        };

        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify(mockConfig), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/go2rtc/config', {
            headers: { 'x-user-id': 'admin-user-123' },
        });
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual(mockConfig);

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringContaining('/api/config'),
        );
    });

    it('returns 500 when go2rtc is unreachable', async () => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('connect ECONNREFUSED 127.0.0.1:1984'),
        );

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/go2rtc/config', {
            headers: { 'x-user-id': 'admin-user-123' },
        });
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to fetch go2rtc configuration' });
    });
});

describe('PATCH /api/admin/go2rtc/config', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        fetchSpy?.mockRestore();
    });

    it('updates go2rtc config', async () => {
        const updatedConfig = { streams: { 'new-stream': { name: 'new-stream' } } };

        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify(updatedConfig), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/go2rtc/config', {
            method: 'PATCH',
            headers: { 'x-user-id': 'admin-user-123' },
            body: { streams: { 'new-stream': { name: 'new-stream' } } },
        });
        const response = await PATCH(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual(updatedConfig);

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringContaining('/api/config'),
            expect.objectContaining({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    });
});
