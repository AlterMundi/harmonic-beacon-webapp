import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), config: vi.fn(), summary: vi.fn() }));
vi.mock('@/lib/early-birds/auth', () => ({ currentEarlyBirdSession: m.session }));
vi.mock('@/lib/early-birds/enabled', () => ({ earlyBirdsEnabled: m.enabled }));
vi.mock('@/lib/listener/account-rp', () => ({ listenerAccountRPConfig: m.config }));
vi.mock('@/lib/listener/profile-summary', () => ({ listenerProfileSummary: m.summary }));
import { GET } from './route';
function request(host = 'listen.harmonicbeacon.com', origin = 'https://live.harmonicbeacon.com') {
    return new Request(`https://${host}/api/listener/profile-summary`, { headers: { host, origin } });
}
beforeEach(() => {
    vi.resetAllMocks(); m.enabled.mockReturnValue(true); m.session.mockResolvedValue({ user: { id: 'own-account' } });
    m.config.mockReturnValue({ issuer: 'https://account.harmonicbeacon.com' }); m.summary.mockResolvedValue({ version: 1 });
});
describe('credentialed profile read boundary', () => {
    it('rejects other sites and cross-environment reads without resolving a session', async () => {
        for (const origin of ['https://evil.example', 'null', 'https://live-staging.harmonicbeacon.com']) expect((await GET(request(undefined, origin))).status).toBe(403);
        expect(m.session).not.toHaveBeenCalled(); expect(m.summary).not.toHaveBeenCalled();
    });
    it('never makes an unavailable service or missing session look like Free', async () => {
        m.session.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
        m.session.mockRejectedValue(new Error('Authority unavailable')); expect((await GET(request())).status).toBe(503);
    });
    it('returns private no-store data only for the session account and exact allowed origin', async () => {
        const response = await GET(request()); expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://live.harmonicbeacon.com');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(m.summary).toHaveBeenCalledWith('own-account', 'https://account.harmonicbeacon.com');
    });
    it('is inert on another product host', async () => { expect((await GET(request('account.harmonicbeacon.com'))).status).toBe(404); expect(m.session).not.toHaveBeenCalled(); });
});
