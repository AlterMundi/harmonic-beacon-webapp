import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestSessionToken } from '../session-auth';
const m = vi.hoisted(() => ({
    userFind: vi.fn(), userCreate: vi.fn(), userFindId: vi.fn(), binding: vi.fn(), audit: vi.fn(),
    sessionCreate: vi.fn(), sessionFind: vi.fn(), sessionUpdate: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
    user: { findUnique: m.userFind, create: m.userCreate, findUniqueOrThrow: m.userFindId },
    staffAccountBinding: { findUnique: m.binding }, auditLog: { create: m.audit },
    webSession: { create: m.sessionCreate, findUniqueOrThrow: m.sessionFind, update: m.sessionUpdate },
}) } }));
import { OPERATOR_PASSWORD, OPERATOR_ISSUER, OPERATOR_SESSION, provisionOperator, issueOperatorCredential, revokeOperatorCredential } from '../operator-credentials';
const user = { id: 'op-id', role: 'ADMIN', passwordDigest: OPERATOR_PASSWORD, disabledAt: null };
beforeEach(() => {
    vi.clearAllMocks(); m.userFind.mockResolvedValue(null); m.userCreate.mockResolvedValue(user);
    m.userFindId.mockResolvedValue(user); m.binding.mockResolvedValue(null); m.sessionCreate.mockResolvedValue({ id: 'credential-id' });
});
describe('root operator provisioning and revocation', () => {
    it('creates its own audited machine ADMIN without usable password or Account binding', async () => {
        await provisionOperator('operator@example.test', 'Operator');
        expect(m.userCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ role: 'ADMIN', passwordDigest: OPERATOR_PASSWORD }) });
        expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'operator.provisioned', actorUserId: user.id }) });
    });
    it.each([{ passwordDigest: 'human' }, { disabledAt: new Date() }, { role: 'FACILITATOR' }])('never replaces or promotes an existing non-machine identity %#', async override => {
        m.userFind.mockResolvedValue({ ...user, ...override });
        await expect(provisionOperator('operator@example.test', 'Operator')).rejects.toThrow();
        expect(m.userCreate).not.toHaveBeenCalled();
    });
    it('refuses to issue on an Account-bound machine identity', async () => {
        m.binding.mockResolvedValue({ id: 'binding' });
        await expect(issueOperatorCredential(user.id, 24)).rejects.toThrow();
        expect(m.sessionCreate).not.toHaveBeenCalled();
    });
    it.each([0, 721, 1.5])('rejects out-of-policy lifetime %s', async ttl => {
        await expect(issueOperatorCredential(user.id, ttl)).rejects.toThrow();
        expect(m.sessionCreate).not.toHaveBeenCalled();
    });
    it('stores only the issued token digest and does not audit the secret', async () => {
        const result = await issueOperatorCredential(user.id, 24);
        expect(result.token).toMatch(/^hbop_v1_[A-Za-z0-9_-]{43}$/);
        expect(m.sessionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenDigest: digestSessionToken(result.token), accountIssuer: OPERATOR_ISSUER, accountSubject: user.id, accountSessionId: OPERATOR_SESSION }) });
        expect(JSON.stringify(m.audit.mock.calls)).not.toContain(result.token);
        expect(JSON.stringify(m.sessionCreate.mock.calls)).not.toContain(result.token);
    });
    it('revokes only credentials in the local machine class and audits it', async () => {
        m.sessionFind.mockResolvedValue({ accountIssuer: OPERATOR_ISSUER, accountSubject: user.id, accountSessionId: OPERATOR_SESSION, staffUser: user });
        await revokeOperatorCredential('credential-id');
        expect(m.sessionUpdate).toHaveBeenCalledWith({ where: { id: 'credential-id' }, data: expect.objectContaining({ revokedAt: expect.any(Date) }) });
        expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'operator.credential.revoked' }) });
        m.sessionFind.mockResolvedValue({ accountIssuer: 'https://account.harmonicbeacon.com', staffUser: user });
        await expect(revokeOperatorCredential('human-session')).rejects.toThrow();
    });
});
