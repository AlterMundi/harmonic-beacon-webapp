import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestSessionToken } from '../session-auth';
const mock = vi.hoisted(() => ({ findUnique: vi.fn(), binding: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { staffAccountBinding: { findUnique: mock.binding }, webSession: { findUnique: mock.findUnique }, auditLog: { create: mock.audit } } }));
import { OPERATOR_ISSUER, OPERATOR_PASSWORD, OPERATOR_SESSION, resolveOperatorAuthorization } from '../operator-credentials';
const token = 'hbop_v1_' + 'a'.repeat(43);
const now = new Date('2026-10-15T00:00:00Z');
function session() { return {
    id: 'credential-id', tokenDigest: digestSessionToken(token), accountIssuer: OPERATOR_ISSUER,
    accountSubject: 'operator-id', accountSessionId: OPERATOR_SESSION, staffUserId: 'operator-id',
    ticketEntitlementId: null, createdAt: new Date(now.getTime() - 60_000),
    expiresAt: new Date(now.getTime() + 60_000), revokedAt: null,
    staffUser: { id: 'operator-id', name: 'Machine operator', email: 'operator@example.test',
        passwordDigest: OPERATOR_PASSWORD, role: 'ADMIN', disabledAt: null },
}; }
beforeEach(() => { vi.clearAllMocks(); mock.binding.mockResolvedValue(null); mock.findUnique.mockResolvedValue(session()); });
describe('machine operator bearer boundary', () => {
    it('resolves the dedicated local identity without Account binding or cookies', async () => {
        expect(await resolveOperatorAuthorization(`Bearer ${token}`, now)).toMatchObject({
            principal: { kind: 'staff', userId: 'operator-id', role: 'ADMIN' },
        });
        expect(mock.findUnique).toHaveBeenCalledWith({ where: { tokenDigest: digestSessionToken(token) }, include: { staffUser: true } });
    });
    it.each(['', 'Basic x', 'Bearer human-session', `Bearer ${token} extra`, `Bearer ${token}\n`])('rejects malformed authentication %j before DB lookup', async value => {
        expect(await resolveOperatorAuthorization(value, now)).toBeNull();
        expect(mock.findUnique).not.toHaveBeenCalled();
    });
    it.each([
        { accountIssuer: 'https://account.harmonicbeacon.com' }, { accountSubject: 'other-user' },
        { accountSessionId: 'human-session' }, { staffUserId: 'other-user' },
        { ticketEntitlementId: 'ticket-id' }, { revokedAt: now }, { expiresAt: now },
        { expiresAt: new Date(now.getTime() + 31 * 86_400_000) },
        { createdAt: new Date(now.getTime() + 1) }, { tokenDigest: 'f'.repeat(64) },
        { staffUser: null },
    ])('denies mismatched or inactive credential %#', async override => {
        mock.findUnique.mockResolvedValue({ ...session(), ...override });
        expect(await resolveOperatorAuthorization(`Bearer ${token}`, now)).toBeNull();
    });
    it.each([{ disabledAt: now }, { passwordDigest: 'human-password' }])('denies disabled or human accounts %#', async override => {
        const row = session(); row.staffUser = { ...row.staffUser, ...override } as typeof row.staffUser;
        mock.findUnique.mockResolvedValue(row);
        expect(await resolveOperatorAuthorization(`Bearer ${token}`, now)).toBeNull();
    });
    it('uses the current local role rather than a cached ADMIN grant', async () => {
        const row = session(); row.staffUser.role = 'FACILITATOR'; mock.findUnique.mockResolvedValue(row);
        expect(await resolveOperatorAuthorization(`Bearer ${token}`, now)).toMatchObject({ principal: { role: 'FACILITATOR' } });
    });
});
