import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn(), requirePath: vi.fn(), output: vi.fn(),
    write: vi.fn(), sync: vi.fn(), close: vi.fn(), fetch: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: m.read }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/operator-credentials', () => ({ OPERATOR_PASSWORD: 'operator-only:v1',
    provisionOperator: vi.fn(), issueOperatorCredential: vi.fn(), revokeOperatorCredential: vi.fn(),
    resolveOperatorAuthorization: m.resolve }));
vi.mock('@/lib/operator-runtime', () => ({ createRootOutput: m.output, requireRootPath: m.requirePath }));
vi.mock('@/lib/session-lifecycle', () => ({ transitionScheduledSession: vi.fn() }));
vi.mock('@/lib/session-termination', () => ({ terminateSessionMedia: vi.fn() }));
import { runOperator } from '../../../scripts/beacon-operator';
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', m.fetch);
    m.read.mockResolvedValue('private-machine-token'); m.resolve.mockResolvedValue({ principal: { role: 'ADMIN' } });
    m.output.mockResolvedValue({ writeFile: m.write, sync: m.sync, close: m.close });
    m.fetch.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
});
afterEach(() => vi.unstubAllGlobals());
describe('operator API uses the selected application namespace', () => {
    it.each(['production', 'staging'] as const)('sends authenticated %s requests to fixed loopback, retaining private output', async environment => {
        expect(await runOperator({ environment, expectedSourceSha: 'a'.repeat(40), operation: 'request',
            method: 'GET', apiPath: '/api/ops/health', tokenPath: '/run/operator-in/credential',
            responsePath: '/run/operator-out/response' })).toEqual({ status: 200, ok: true });
        expect(m.fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/ops/health', expect.objectContaining({
            redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer private-machine-token',
                Origin: environment === 'production' ? 'https://live.harmonicbeacon.com' : 'https://live-staging.harmonicbeacon.com',
                Host: environment === 'production' ? 'live.harmonicbeacon.com' : 'live-staging.harmonicbeacon.com',
            }),
        }));
        expect(m.write).toHaveBeenCalledWith(Buffer.from('{"status":"ok"}'));
        expect(m.close).toHaveBeenCalledOnce();
    });
    it('does not retry a failed local request against public ingress', async () => {
        m.fetch.mockRejectedValue(new Error('connection refused'));
        await expect(runOperator({ environment: 'staging', expectedSourceSha: 'a'.repeat(40), operation: 'request',
            method: 'GET', apiPath: '/api/ops/health', tokenPath: '/run/operator-in/credential',
            responsePath: '/run/operator-out/response' })).rejects.toThrow('connection refused');
        expect(m.fetch).toHaveBeenCalledOnce(); expect(m.write).not.toHaveBeenCalled(); expect(m.close).toHaveBeenCalledOnce();
    });
});
