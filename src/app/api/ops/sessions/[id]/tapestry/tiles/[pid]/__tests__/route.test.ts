import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    tapestryInternalUrl: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: { scheduledSession: { findUnique: mocks.sessionFindUnique } },
}));
vi.mock('@/lib/tapestry', () => ({ tapestryInternalUrl: mocks.tapestryInternalUrl }));

import { GET } from '../route';

const SESSION_ID = 'session-1';
const OPAQUE_PID = 'tp-opaque-hmac-id';

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.requireStaff.mockResolvedValue([{
        kind: 'staff',
        webSessionId: 'web-1',
        userId: 'operator-1',
        role: 'OPERATOR',
    }, null]);
    mocks.sessionFindUnique.mockResolvedValue({ facilitatorId: 'facilitator-1' });
    mocks.tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
    process.env.TAPESTRY_INTERNAL_SECRET = 'test-tapestry-secret';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GET private tapestry tile', () => {
    it('serves a staff-authorized tile with a short private cache and no public identifier', async () => {
        mocks.fetch.mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
        }));

        const response = await GET(
            createRequest(`/api/ops/sessions/${SESSION_ID}/tapestry/tiles/${OPAQUE_PID}`),
            mockParams({ id: SESSION_ID, pid: OPAQUE_PID }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, max-age=4, must-revalidate');
        expect(response.headers.get('vary')).toBe('Cookie');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(mocks.fetch).toHaveBeenCalledWith(
            `http://tapestry:3100/tapestry/sessions/${SESSION_ID}/participants/${OPAQUE_PID}/frame.jpg`,
            expect.objectContaining({ cache: 'no-store' }),
        );
        expect(JSON.stringify(mocks.fetch.mock.calls)).not.toMatch(/name|email|ticket/i);
    });

    it('rejects a malformed opaque participant id before contacting tapestry', async () => {
        const response = await GET(
            createRequest('http://localhost/tile'),
            mockParams({ id: 'session-1', pid: '../participant' }),
        );

        expect(response.status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('denies attendee access before session or tapestry lookup', async () => {
        mocks.requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
        ]);

        const response = await GET(
            createRequest(`/api/ops/sessions/${SESSION_ID}/tapestry/tiles/${OPAQUE_PID}`),
            mockParams({ id: SESSION_ID, pid: OPAQUE_PID }),
        );

        expect(response.status).toBe(403);
        expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('denies a facilitator assigned elsewhere and returns 404 for an unknown session', async () => {
        mocks.requireStaff.mockResolvedValue([{
            kind: 'staff',
            webSessionId: 'web-2',
            userId: 'facilitator-elsewhere',
            role: 'FACILITATOR',
        }, null]);

        const forbidden = await GET(
            createRequest(`/api/ops/sessions/${SESSION_ID}/tapestry/tiles/${OPAQUE_PID}`),
            mockParams({ id: SESSION_ID, pid: OPAQUE_PID }),
        );
        expect(forbidden.status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();

        mocks.sessionFindUnique.mockResolvedValueOnce(null);
        const missing = await GET(
            createRequest('/api/ops/sessions/missing/tapestry/tiles/tp-safe'),
            mockParams({ id: 'missing', pid: 'tp-safe' }),
        );
        expect(missing.status).toBe(404);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('fails closed without blocking the queue API when the internal image is absent', async () => {
        mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
        const response = await GET(
            createRequest(`/api/ops/sessions/${SESSION_ID}/tapestry/tiles/${OPAQUE_PID}`),
            mockParams({ id: SESSION_ID, pid: OPAQUE_PID }),
        );
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Tapestry unavailable' });
    });
});
