import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applyMembershipProjection = vi.hoisted(() => vi.fn());

vi.mock('../membership', async (importOriginal) => ({
    ...await importOriginal<typeof import('../membership')>(),
    applyMembershipProjection,
}));

import {
    HttpEarlyBirdMembershipGateway,
    redeemFreeThroughCanonicalGateway,
} from '../membership-gateway';

const TOKEN = 'ebi_v1.AAAAAAAAAAAAAAAAAAAAAA.synthetic_nonce_00000000000000000000.synthetic_signature_0000000000000000000000000000000';
const authorityMembership = {
    schema_version: 'early-bird-authority.membership.v3',
    account_id: 'listener-1',
    membership_revision: 1,
    state: 'ACTIVE',
    source: 'FREE',
    access_allowed: true,
    effective_at: '2026-08-06T12:00:00Z',
    paid_through: null,
    grace_until: null,
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    provider: null,
    current_price: null,
    free_entitlement_consumed: false,
    reason_code: 'INVITATION_REDEEMED',
    founder_continuity: null,
};

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe('canonical EarlyBird membership HTTP gateway', () => {
    it('sends the exact authenticated contract and applies only the returned projection', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(authorityMembership), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'http://pmp-myth-bot:3000',
            keyId: '2026-08-current',
            token: 's'.repeat(43),
        }, request);
        applyMembershipProjection.mockResolvedValue({ outcome: 'APPLIED' });

        await expect(redeemFreeThroughCanonicalGateway('listener-1', TOKEN, gateway))
            .resolves.toMatchObject({ ok: true, replayed: false });

        const [url, init] = request.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://pmp-myth-bot:3000/api/internal/v1/early-bird-invitations/redeem');
        expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
        expect(init.headers).toMatchObject({
            authorization: `Bearer ${'s'.repeat(43)}`,
            'x-hb-service-key-id': '2026-08-current',
            'content-type': 'application/json',
        });
        expect((init.headers as Record<string, string>)['idempotency-key']).toMatch(
            /^early-bird-invitation-redeem:[a-f0-9]{64}$/,
        );
        expect((init.headers as Record<string, string>)['idempotency-key']).not.toContain(TOKEN);
        expect(JSON.parse(String(init.body))).toEqual({
            schema_version: 'early-bird-authority.invitation-redeem.v1',
            account_id: 'listener-1',
            invitation_token: TOKEN,
        });
        expect(applyMembershipProjection).toHaveBeenCalledWith(expect.objectContaining({
            schema_version: 'early-bird-membership.command.v2',
            account_id: 'listener-1',
            membership_revision: 1,
        }));
    });

    it('rejects malformed invitations locally and never calls the authority', async () => {
        const gateway = { redeemFree: vi.fn() };
        await expect(redeemFreeThroughCanonicalGateway('listener-1', 'x'.repeat(43), gateway))
            .resolves.toEqual({ ok: false, reason: 'unavailable' });
        expect(gateway.redeemFree).not.toHaveBeenCalled();
    });

    it.each([
        'listener/1',
        '-listener',
        `a${'b'.repeat(128)}`,
    ])('rejects account IDs outside the canonical authority contract: %s', async (accountId) => {
        const gateway = { redeemFree: vi.fn() };
        await expect(redeemFreeThroughCanonicalGateway(accountId, TOKEN, gateway))
            .resolves.toEqual({ ok: false, reason: 'unavailable' });
        expect(gateway.redeemFree).not.toHaveBeenCalled();
    });

    it('fails closed on mismatched or structurally invalid authority responses', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            ...authorityMembership,
            account_id: 'someone-else',
        }), { status: 200 }));
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'https://authority.example.test',
            keyId: 'current',
            token: 's'.repeat(43),
        }, request);
        await expect(gateway.redeemFree({ accountId: 'listener-1', opaqueInvitation: TOKEN }))
            .rejects.toThrow('unavailable');
        expect(applyMembershipProjection).not.toHaveBeenCalled();
    });

    it('fails closed when authority access contradicts canonical state semantics', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            ...authorityMembership,
            state: 'ACTIVE',
            paid_through: null,
            access_allowed: false,
        }), { status: 200 }));
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'https://authority.example.test',
            keyId: 'current',
            token: 's'.repeat(43),
        }, request);

        await expect(gateway.redeemFree({ accountId: 'listener-1', opaqueInvitation: TOKEN }))
            .rejects.toThrow('unavailable');
        expect(applyMembershipProjection).not.toHaveBeenCalled();
    });
});
