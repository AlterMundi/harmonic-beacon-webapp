import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    apply: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock('@/lib/early-birds/service-auth', () => ({
    authorizeEarlyBirdMembershipService: mocks.authorize,
}));
vi.mock('@/lib/early-birds/membership', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/early-birds/membership')>(),
    applyMembershipProjection: mocks.apply,
}));
vi.mock('@/lib/db', () => ({
    prisma: { earlyBirdMembershipProjection: { findUnique: mocks.findUnique } },
}));

import { GET, PUT } from '../route';

const ACCOUNT = 'listener-1';
const continuity = {
    episode_id: '00000000-0000-4000-8000-000000000101',
    revision: 2,
    state: 'ACTIVE',
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    canonical_price: { currency: 'USD', amount_minor: 500 },
    billing_period: 'MONTHLY',
    activated_at: '2026-08-06T12:00:00Z',
    service_through: '2026-09-06T12:00:00Z',
    ended_at: null,
    terminal_reason: null,
};
const command = {
    schema_version: 'early-bird-membership.command.v2',
    account_id: ACCOUNT,
    membership_revision: 3,
    state: 'ACTIVE',
    source: 'PAYPAL',
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    effective_at: '2026-08-06T12:00:00Z',
    paid_through: '2026-09-06T12:00:00Z',
    grace_until: null,
    provider: 'paypal',
    current_price: { currency: 'USD', amount_minor: 500 },
    reason_code: 'PAYMENT_SUCCEEDED',
    founder_continuity: continuity,
};
const projection = {
    id: 'eb100000-0000-4000-8000-000000000001',
    accountId: ACCOUNT,
    revision: 3,
    commandHash: 'a'.repeat(64),
    state: 'ACTIVE',
    source: 'PAYPAL',
    offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
    offerRevision: 1,
    effectiveAt: new Date('2026-08-06T12:00:00Z'),
    paidThrough: new Date('2026-09-06T12:00:00Z'),
    graceUntil: null,
    provider: 'paypal',
    amountMinor: 500,
    currency: 'USD',
    reasonCode: 'PAYMENT_SUCCEEDED',
    synthetic: false,
    founderContinuityEpisodeId: continuity.episode_id,
    founderContinuityRevision: continuity.revision,
    founderContinuityState: 'ACTIVE',
    founderContinuityOfferCode: 'EARLY_BIRDS_FOUNDERS_V1',
    founderContinuityOfferRevision: 1,
    founderContinuityCurrency: 'USD',
    founderContinuityAmountMinor: 500,
    founderContinuityBillingPeriod: 'MONTHLY',
    founderContinuityActivatedAt: new Date(continuity.activated_at),
    founderContinuityServiceThrough: new Date(continuity.service_through),
    founderContinuityEndedAt: null,
    founderContinuityTerminalReason: null,
    createdAt: new Date('2026-08-06T12:00:00Z'),
    updatedAt: new Date('2026-08-06T12:00:00Z'),
};

function put(body: unknown = command, headers: Record<string, string> = {}) {
    return new NextRequest(`http://beacon-app:3000/api/internal/v2/early-bird-memberships/${ACCOUNT}`, {
        method: 'PUT',
        headers: {
            authorization: 'Bearer secret-not-logged',
            'x-hb-service-key-id': 'current',
            'content-type': 'application/json',
            'idempotency-key': `early-bird-membership:${ACCOUNT}:3`,
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

const params = { params: Promise.resolve({ accountId: ACCOUNT }) };

describe('private EarlyBird membership projection v2 route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockReturnValue(true);
        mocks.apply.mockResolvedValue({ projection, outcome: 'APPLIED' });
        mocks.findUnique.mockResolvedValue(projection);
    });

    it.each(['APPLIED', 'REPLAYED', 'STALE'] as const)('returns the canonical %s outcome', async (outcome) => {
        mocks.apply.mockResolvedValue({ projection, outcome });
        const response = await PUT(put(), params);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        await expect(response.json()).resolves.toEqual({
            schema_version: 'early-bird-membership.result.v1',
            membership_id: projection.id,
            account_id: ACCOUNT,
            outcome,
            applied_revision: 3,
            effective_state: 'ACTIVE',
            access_allowed: true,
            reconciliation_required: false,
        });
    });

    it('authenticates before parsing and rejects v1, extra fields and wrong idempotency', async () => {
        mocks.authorize.mockReturnValue(false);
        const unauthorized = await PUT(put({ secret_material: 'not-read' }), params);
        expect(unauthorized.status).toBe(401);
        expect(mocks.apply).not.toHaveBeenCalled();

        mocks.authorize.mockReturnValue(true);
        expect((await PUT(put({ ...command, schema_version: 'early-bird-membership.command.v1' }), params)).status)
            .toBe(422);
        expect((await PUT(put({ ...command, unexpected: true }), params)).status).toBe(422);
        expect((await PUT(put(command, { 'idempotency-key': 'wrong' }), params)).status).toBe(422);
    });

    it('returns the non-secret current projection acknowledgement', async () => {
        const request = new NextRequest(
            `http://beacon-app:3000/api/internal/v2/early-bird-memberships/${ACCOUNT}`,
            { headers: { authorization: 'Bearer hidden', 'x-hb-service-key-id': 'current' } },
        );
        const response = await GET(request, params);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            schema_version: 'early-bird-membership.result.v1',
            account_id: ACCOUNT,
            outcome: 'REPLAYED',
        });
    });
});
