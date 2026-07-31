import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    tapestryInternalUrl: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.sessionFindUnique },
    },
}));
vi.mock('@/lib/tapestry', () => ({ tapestryInternalUrl: mocks.tapestryInternalUrl }));

import { GET, PUT } from '../route';

const STAFF = { userId: 'staff-1', role: 'OPERATOR' };
const SESSION_ID = 'session-1';

function staffOk(role = 'OPERATOR') {
    mocks.requireStaff.mockResolvedValue([{ ...STAFF, role }, null]);
    mocks.sessionFindUnique.mockResolvedValue({ facilitatorId: 'facil-1' });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.tapestryInternalUrl.mockReturnValue('http://tapestry:3100');
    process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret';
});

describe('ops tapestry route', () => {
    it('GET proxies the participants list for staff', async () => {
        staffOk();
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ participants: ['tp-a', 'tp-b'] }), { status: 200 }));

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ participants: ['tp-a', 'tp-b'] });
        const [url, init] = mocks.fetch.mock.calls[0];
        expect(String(url)).toBe(`http://tapestry:3100/tapestry/sessions/${SESSION_ID}/participants`);
        expect(init.headers['x-tapestry-internal-secret']).toBe('test-secret');
    });

    it('GET rejects a facilitator of another event', async () => {
        staffOk('FACILITATOR');
        mocks.requireStaff.mockResolvedValue([{ userId: 'staff-9', role: 'FACILITATOR' }, null]);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('PUT validates the order before proxying', async () => {
        staffOk();
        const bad = await PUT(
            createRequest('http://x', { method: 'PUT', body: { order: ['a', 'a'] } }),
            mockParams({ id: SESSION_ID }),
        );
        expect(bad.status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('PUT proxies a valid arrangement', async () => {
        staffOk();
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, stored: 2 }), { status: 200 }));

        const response = await PUT(
            createRequest('http://x', { method: 'PUT', body: { order: ['tp-b', 'tp-a'] } }),
            mockParams({ id: SESSION_ID }),
        );

        expect(response.status).toBe(200);
        const [url, init] = mocks.fetch.mock.calls[0];
        expect(String(url)).toBe(`http://tapestry:3100/tapestry/sessions/${SESSION_ID}/order`);
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body as string)).toEqual({ order: ['tp-b', 'tp-a'] });
    });

    it('returns 503 when the service is not configured', async () => {
        staffOk();
        mocks.tapestryInternalUrl.mockReturnValue(null);

        const response = await GET(createRequest('http://x'), mockParams({ id: SESSION_ID }));
        expect(response.status).toBe(503);
    });
});
