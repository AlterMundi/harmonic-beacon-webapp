import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    queryRaw: vi.fn(),
}));

vi.mock('@/lib/commerce-service-auth', () => ({
    authorizeCommerceService: mocks.authorize,
}));
vi.mock('@/lib/db', () => ({
    prisma: { $queryRaw: mocks.queryRaw },
}));

import { GET } from '../route';

const URL = 'http://beacon-app:3000/api/internal/v1/amplification-credit-entries';

function request(query = '', headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`${URL}${query}`, {
        headers: {
            authorization: 'Bearer secret-not-logged',
            'x-hb-service-key-id': 'current',
            ...headers,
        },
    });
}

describe('private amplification credit entry feed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockReturnValue(true);
        mocks.queryRaw.mockResolvedValue([]);
    });

    it('reuses commerce service authentication and fails closed before querying', async () => {
        mocks.authorize.mockReturnValue(false);
        const response = await GET(request());
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(mocks.authorize).toHaveBeenCalledWith('Bearer secret-not-logged', 'current');
        expect(mocks.queryRaw).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            error: 'unauthorized',
            message: 'Service authentication failed',
        });
    });

    it('returns the v1 envelope with nullable identity fields and private no-store', async () => {
        mocks.queryRaw.mockResolvedValue([{
            entry_id: '70000000-0000-4000-8000-000000000002',
            scheduled_session_id: '10000000-0000-4000-8000-000000000001',
            ticket_entitlement_id: '50000000-0000-4000-8000-000000000002',
            registration_id: null,
            email: null,
            display_name: null,
            entered_at: new Date('2026-08-09T20:15:30.000Z'),
        }]);

        const response = await GET(request('?limit=1'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({
            schema_version: 'amplification-credit-entries.v1',
            entries: [{
                entry_id: '70000000-0000-4000-8000-000000000002',
                scheduled_session_id: '10000000-0000-4000-8000-000000000001',
                ticket_entitlement_id: '50000000-0000-4000-8000-000000000002',
                registration_id: null,
                email: null,
                display_name: null,
                entered_at: '2026-08-09T20:15:30.000Z',
            }],
            next_cursor: expect.any(String),
        });
    });

    it('rejects malformed cursors and out-of-range limits without querying', async () => {
        for (const query of ['?cursor=not+base64url', '?limit=101', '?limit=01']) {
            const response = await GET(request(query));
            expect(response.status).toBe(400);
            expect(response.headers.get('cache-control')).toBe('private, no-store');
        }
        expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it('keeps private no-store on unexpected database failures', async () => {
        mocks.queryRaw.mockRejectedValue(new Error('sensitive database detail'));
        const response = await GET(request());
        expect(response.status).toBe(500);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toMatchObject({ error: 'amplification_credit_feed_unavailable' });
    });
});
