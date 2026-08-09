import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    findAccount: vi.fn(),
    readMembership: vi.fn(),
    apply: vi.fn(),
}));

vi.mock('@/lib/early-birds/service-auth', () => ({
    authorizeEarlyBirdMembershipService: mocks.authorize,
}));
vi.mock('@/lib/db', () => ({
    prisma: { earlyBirdUser: { findUnique: mocks.findAccount } },
}));
vi.mock('@/lib/early-birds/membership-gateway', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/early-birds/membership-gateway')>(),
    earlyBirdMembershipReader: () => ({ readMembership: mocks.readMembership }),
}));
vi.mock('@/lib/early-birds/founder-eligibility', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/early-birds/founder-eligibility')>(),
    applyFounderEligibilityProjection: mocks.apply,
}));

import { FounderEligibilityConflictError } from '@/lib/early-birds/founder-eligibility';
import { EarlyBirdMembershipGatewayUnavailableError } from '@/lib/early-birds/membership-gateway';

import { POST } from '../route';

const ACCOUNT = 'listener-1';
const eligibility = {
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    canonical_price: { currency: 'USD', amount_minor: 500 },
    billing_period: 'MONTHLY',
    granted_at: '2026-08-06T12:00:00Z',
};
const canonical = {
    schema_version: 'early-bird-authority.membership.v2',
    account_id: ACCOUNT,
    membership_revision: 2,
    state: 'EXPIRED',
    source: 'PAYPAL',
    access_allowed: false,
    effective_at: '2026-08-06T12:00:00Z',
    paid_through: '2026-09-06T12:00:00Z',
    grace_until: null,
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    provider: 'paypal',
    current_price: { currency: 'USD', amount_minor: 500 },
    free_entitlement_consumed: true,
    reason_code: 'SUBSCRIPTION_CANCELLED',
    founder_price_eligibility: eligibility,
};

function request(headers: Record<string, string> = {}) {
    return new NextRequest(
        `http://beacon-app:3000/api/internal/v1/early-bird-founder-eligibilities/${ACCOUNT}/reconcile`,
        {
            method: 'POST',
            headers: {
                authorization: 'Bearer secret-not-logged',
                'x-hb-service-key-id': 'current',
                ...headers,
            },
        },
    );
}

const params = { params: Promise.resolve({ accountId: ACCOUNT }) };

describe('private Founder eligibility reconciliation route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockReturnValue(true);
        mocks.findAccount.mockResolvedValue({ id: ACCOUNT });
        mocks.readMembership.mockResolvedValue({ ok: true, membership: canonical });
        mocks.apply.mockResolvedValue('APPLIED');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('authenticates before local lookup or outbound authority access', async () => {
        mocks.authorize.mockReturnValue(false);
        const response = await POST(request(), params);
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(mocks.findAccount).not.toHaveBeenCalled();
        expect(mocks.readMembership).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it('rejects an unknown local account without contacting the authority', async () => {
        mocks.findAccount.mockResolvedValue(null);
        const response = await POST(request(), params);
        expect(response.status).toBe(404);
        expect(mocks.readMembership).not.toHaveBeenCalled();
    });

    it.each(['ABSENT', 'APPLIED', 'REPLAYED'] as const)('returns only the sanitized %s outcome', async (outcome) => {
        mocks.apply.mockResolvedValue(outcome);
        if (outcome === 'ABSENT') {
            mocks.readMembership.mockResolvedValue({
                ok: true,
                membership: { ...canonical, founder_price_eligibility: null },
            });
        }
        const response = await POST(request(), params);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({
            schema_version: 'listener-founder-eligibility-reconciliation.result.v1',
            outcome,
            founder_price_eligible: outcome !== 'ABSENT',
        });
        expect(mocks.apply).toHaveBeenCalledWith(
            ACCOUNT,
            outcome === 'ABSENT' ? null : eligibility,
        );
    });

    it('maps authority absence and durable evidence conflict to generic 409', async () => {
        mocks.readMembership.mockResolvedValue({ ok: false, reason: 'not-found' });
        const absent = await POST(request(), params);
        expect(absent.status).toBe(409);

        mocks.readMembership.mockResolvedValue({ ok: true, membership: canonical });
        mocks.apply.mockRejectedValue(new FounderEligibilityConflictError());
        const conflict = await POST(request(), params);
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toEqual({ error: 'Founder eligibility reconciliation conflict.' });
    });

    it('maps authority and database failures without leaking their material', async () => {
        mocks.readMembership.mockRejectedValue(new EarlyBirdMembershipGatewayUnavailableError());
        const authority = await POST(request(), params);
        expect(authority.status).toBe(503);
        expect(await authority.json()).toEqual({ error: 'Founder eligibility authority unavailable.' });

        mocks.readMembership.mockResolvedValue({ ok: true, membership: canonical });
        mocks.apply.mockRejectedValue(new Error('subscription secret provider body'));
        const database = await POST(request(), params);
        expect(database.status).toBe(500);
        expect(JSON.stringify(await database.json())).not.toContain('subscription secret provider body');
    });
});
