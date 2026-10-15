import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), binding: vi.fn(), transition: vi.fn(), terminate: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { staffAccountBinding: { findUnique: m.binding }, user: { findUniqueOrThrow: m.user }, scheduledSession: { findUniqueOrThrow: m.session } } }));
vi.mock('@/lib/session-lifecycle', () => ({ transitionScheduledSession: m.transition }));
vi.mock('@/lib/session-termination', () => ({ terminateSessionMedia: m.terminate }));
import { closeOperatorSessions, validateOperatorRequest } from '../../../scripts/beacon-operator';
import { OPERATOR_PASSWORD } from '../operator-credentials';
const id = '11111111-1111-4111-8111-111111111111';
const source = 'a'.repeat(40);
const env = { BEACON_GIT_SHA: source, BEACON_OPERATOR_ENVIRONMENT: 'production', DATABASE_URL: 'postgresql://localhost/beacon' };
const request = { environment: 'production' as const, expectedSourceSha: source, operation: 'close' as const,
    email: 'operator@example.test', sessionIds: [id], reason: 'Human confirmed the event has ended' };
beforeEach(() => {
    vi.clearAllMocks(); m.binding.mockResolvedValue(null);
    m.user.mockResolvedValue({ id: 'operator', role: 'ADMIN', passwordDigest: OPERATOR_PASSWORD, disabledAt: null });
    m.session.mockResolvedValue({ id, status: 'LIVE' });
    m.transition.mockImplementation(async () => { m.session.mockResolvedValue({ id, status: 'ENDED' }); return { status: 'ENDED' }; });
    m.terminate.mockResolvedValue({ complete: true, failures: [] });
});
describe('root operator command', () => {
    it('requires exact source/environment and named targets', () => {
        expect(validateOperatorRequest(request, env)).toEqual(request);
        expect(validateOperatorRequest({ ...request, environment: 'staging' }, { ...env, BEACON_OPERATOR_ENVIRONMENT: 'staging', DATABASE_URL: 'postgresql://localhost/beacon_live_staging' })).toMatchObject({ environment: 'staging' });
        expect(() => validateOperatorRequest(request, { ...env, BEACON_GIT_SHA: 'b'.repeat(40) })).toThrow();
        expect(() => validateOperatorRequest(request, { ...env, BEACON_OPERATOR_ENVIRONMENT: 'staging' })).toThrow();
        expect(() => validateOperatorRequest({ ...request, sessionIds: [] }, env)).toThrow();
        expect(() => validateOperatorRequest({ ...request, reason: '' }, env)).toThrow();
        expect(() => validateOperatorRequest({ ...request, sql: 'UPDATE' }, env)).toThrow();
    });
    it.each(['/api/internal/x','//evil.example/api/ops/x','/api/ops/../internal','/api/ops/%2e%2e/internal'])('rejects unsupported API paths %s', apiPath => {
        expect(() => validateOperatorRequest({ ...request, operation: 'request', method: 'GET', apiPath,
            tokenPath: '/root/token', responsePath: '/root/output' }, env)).toThrow();
    });
    it('calls the normal lifecycle and termination functions with the database actor', async () => {
        expect(await closeOperatorSessions(request)).toEqual([{ sessionId: id, status: 'ENDED', termination: { complete: true, failures: [] } }]);
        expect(m.transition).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id, actor: expect.objectContaining({ id: 'operator' }), targetStatus: 'ENDED' }));
        expect(m.terminate).toHaveBeenCalledWith({ sessionId: id, actorUserId: 'operator', actorRole: 'ADMIN' });
    });
    it.each(['SCHEDULED','CANCELLED'])('never opens or closes an unheld %s event', async status => {
        m.session.mockResolvedValue({ id, status });
        await expect(closeOperatorSessions(request)).rejects.toThrow();
        expect(m.transition).not.toHaveBeenCalled(); expect(m.terminate).not.toHaveBeenCalled();
    });
    it('rejects human or disabled actors', async () => {
        m.user.mockResolvedValue({ id: 'human', role: 'ADMIN', passwordDigest: 'human-password', disabledAt: null });
        await expect(closeOperatorSessions(request)).rejects.toThrow();
        expect(m.transition).not.toHaveBeenCalled();
    });
    it('fails on incomplete termination and permits a later ENDED retry', async () => {
        m.terminate.mockResolvedValueOnce({ complete: false, failures: ['stage'] });
        await expect(closeOperatorSessions(request)).rejects.toThrow('closure incomplete');
        expect(await closeOperatorSessions(request)).toMatchObject([{ status: 'ENDED' }]);
        expect(m.transition).toHaveBeenCalledTimes(2);
    });
});
