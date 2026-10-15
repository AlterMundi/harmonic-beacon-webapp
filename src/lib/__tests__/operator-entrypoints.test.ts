import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), cookieGet: vi.fn(), headerGet: vi.fn(), findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { webSession: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/operator-credentials', () => ({ OPERATOR_ISSUER: 'urn:harmonic-beacon:operator:v1', OPERATOR_TOKEN_PREFIX: 'hbop_v1_', resolveOperatorAuthorization: mocks.resolve }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookieGet }), headers: async () => ({ get: mocks.headerGet }) }));
import { currentPrincipal, principalFromToken } from '../principal';
import { resolveStaffSession, resolveStaffByToken } from '../ops-auth';
const operator = { principal: { kind: 'staff', webSessionId: 'ws', userId: 'op', role: 'ADMIN' },
    staff: { id: 'op', role: 'ADMIN', name: 'Operator', email: 'operator@example.test' } };
beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue(operator); });
describe('operator authentication at both Staff boundaries', () => {
    it('supports requireStaff/currentPrincipal and explicit request auth', async () => {
        mocks.headerGet.mockReturnValue('Bearer machine-token');
        expect(await currentPrincipal()).toEqual(operator.principal);
        expect(await resolveStaffSession(new NextRequest('https://live.harmonicbeacon.com/api/ops/x', { headers: { Authorization: 'Bearer machine-token' } }))).toEqual(operator.staff);
        expect(mocks.cookieGet).not.toHaveBeenCalled();
    });
    it('never falls back to a human cookie after invalid Authorization', async () => {
        mocks.headerGet.mockReturnValue('Bearer invalid'); mocks.resolve.mockResolvedValue(null);
        mocks.cookieGet.mockReturnValue({ value: 'human-cookie' });
        expect(await currentPrincipal()).toBeNull();
        expect(await resolveStaffSession(new NextRequest('https://live.harmonicbeacon.com/api/ops/x', { headers: { Authorization: 'Bearer invalid', Cookie: 'hb_session=human-cookie' } }))).toBeNull();
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.cookieGet).not.toHaveBeenCalled();
    });
    it('rejects machine tokens in both human cookie entrypoints', async () => {
        expect(await principalFromToken('hbop_v1_' + 'a'.repeat(43))).toBeNull();
        expect(await resolveStaffByToken('hbop_v1_' + 'a'.repeat(43))).toBeNull();
        expect(mocks.findUnique).not.toHaveBeenCalled();
    });
    it('also rejects local machine rows reached with an unprefixed cookie', async () => {
        mocks.findUnique.mockResolvedValue({ accountIssuer: 'urn:harmonic-beacon:operator:v1', staffUser: operator.staff });
        expect(await principalFromToken('unprefixed-cookie')).toBeNull();
        expect(await resolveStaffByToken('unprefixed-cookie')).toBeNull();
    });
});
