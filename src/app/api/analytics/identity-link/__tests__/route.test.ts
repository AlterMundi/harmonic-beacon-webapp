import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentAccountSession: vi.fn(), currentEarlyBirdSession: vi.fn(), emitAnalyticsEvent: vi.fn(), isAccountHost: vi.fn(),
}));
vi.mock('@/lib/account/auth', () => ({ currentAccountSession: mocks.currentAccountSession }));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: mocks.currentEarlyBirdSession }));
vi.mock('@/lib/analytics-server', () => ({ emitAnalyticsEvent: mocks.emitAnalyticsEvent }));
vi.mock('@/lib/account/config', () => ({ isAccountHost: mocks.isAccountHost }));

import { POST } from '../route';

const visitor = '10000000-0000-4000-8000-000000000001';
const session = '10000000-0000-4000-8000-000000000002';
const request = (body: unknown, host = 'account.harmonicbeacon.com') => new Request('https://example.invalid/api/analytics/identity-link', {
    method: 'POST', headers: { host, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('analytics identity link', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.emitAnalyticsEvent.mockResolvedValue(true); });
    it('links only opaque browser IDs to the authenticated Account on the server', async () => {
        mocks.isAccountHost.mockReturnValue(true);
        mocks.currentAccountSession.mockResolvedValue({ user: { id: 'canonical-account-id' } });
        const response = await POST(request({ visitor_id: visitor, session_id: session }));
        expect(response.status).toBe(204);
        expect(mocks.emitAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
            eventName: 'identity.linked', accountId: 'canonical-account-id', visitorId: visitor, sessionId: session,
        }));
    });
    it('rejects unauthenticated and client-declared extra identity fields', async () => {
        mocks.isAccountHost.mockReturnValue(false);
        mocks.currentEarlyBirdSession.mockResolvedValue(null);
        expect((await POST(request({ visitor_id: visitor, session_id: session }, 'listen.harmonicbeacon.com'))).status).toBe(401);
        expect((await POST(request({ visitor_id: visitor, session_id: session, account_subject: 'x' }))).status).toBe(400);
        expect(mocks.emitAnalyticsEvent).not.toHaveBeenCalled();
    });
});
