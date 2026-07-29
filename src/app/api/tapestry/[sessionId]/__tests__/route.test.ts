import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaff = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/auth', () => ({ requireStaff }));
vi.mock('@/lib/db', () => ({ prisma: { scheduledSession: { findUnique } } }));

const context = { params: Promise.resolve({ sessionId: 'session-1' }) };

describe('GET /api/tapestry/[sessionId]', () => {
    beforeEach(() => {
        vi.resetModules(); vi.clearAllMocks();
        process.env.TAPESTRY_INTERNAL_URL = 'http://tapestry:3100';
        process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret-at-least-16-chars';
        process.env.TAPESTRY_PUBLIC_ENABLED = 'false';
        requireStaff.mockResolvedValue([{ role: 'OPERATOR' }, null]);
        global.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 }));
    });

    it('keeps staff-only composites private and requires staff authorization', async () => {
        const { GET } = await import('../route');
        const response = await GET(new NextRequest('http://localhost/api/tapestry/session-1'), context);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(requireStaff).toHaveBeenCalledWith('FACILITATOR', 'OPERATOR', 'ADMIN');
        expect(findUnique).not.toHaveBeenCalled();
    });

    it('rejects unauthorised callers without reaching the internal service', async () => {
        requireStaff.mockResolvedValue([null, NextResponse.json({ error: 'Authentication required' }, { status: 401 })]);
        const { GET } = await import('../route');
        expect((await GET(new NextRequest('http://localhost/api/tapestry/session-1'), context)).status).toBe(401);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('uses a cookie-independent two-second shared cache policy in public mode', async () => {
        process.env.TAPESTRY_PUBLIC_ENABLED = 'true';
        findUnique.mockResolvedValue({ id: 'session-1' });
        const { GET } = await import('../route');
        const response = await GET(new NextRequest('http://localhost/api/tapestry/session-1', { headers: { cookie: 'hb_session=ignored' } }), context);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('s-maxage=2');
        expect(response.headers.get('cdn-cache-control')).toBe('public, max-age=2');
        expect(requireStaff).not.toHaveBeenCalled();
    });
});
