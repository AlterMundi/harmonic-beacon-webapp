import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdMembershipProjection: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
}));

const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
}));
const quota = vi.hoisted(() => ({
    assertListenerQuotaPolicyCompatible: vi.fn(),
    listenerQuotaDatabaseNow: vi.fn(),
    settleLockedEarlyBirdQuota: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('../quota', () => quota);

import {
    applyMembershipProjection,
    EarlyBirdProjectionConflictError,
    membershipAccessDecision,
    membershipCommandHash,
    type EarlyBirdMembershipProjectionCommand,
} from '../membership';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function projection(overrides: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        accountId: 'listener-1',
        revision: 1,
        commandHash: 'a'.repeat(64),
        state: 'ACTIVE',
        source: 'FREE',
        offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
        offerRevision: 1,
        effectiveAt: NOW,
        paidThrough: null,
        graceUntil: null,
        provider: null,
        amountMinor: null,
        currency: null,
        reasonCode: 'INVITATION_REDEEMED',
        synthetic: false,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    } as never;
}

function command(overrides: Partial<EarlyBirdMembershipProjectionCommand> = {}) {
    return {
        schema_version: 'early-bird-membership.command.v1',
        account_id: 'listener-1',
        membership_revision: 1,
        state: 'ACTIVE',
        source: 'FREE',
        offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
        effective_at: NOW.toISOString(),
        paid_through: null,
        grace_until: null,
        provider: null,
        current_price: null,
        reason_code: 'INVITATION_REDEEMED',
        ...overrides,
    } satisfies EarlyBirdMembershipProjectionCommand;
}

describe('EarlyBird membership read model', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 'listener-1' }]);
        quota.listenerQuotaDatabaseNow.mockResolvedValue(NOW);
        quota.settleLockedEarlyBirdQuota.mockResolvedValue({});
    });

    it('fails closed for missing/ended access and respects paid/grace horizons', () => {
        expect(membershipAccessDecision(null, NOW)).toMatchObject({ allowed: false, reason: 'missing' });
        expect(membershipAccessDecision(projection(), NOW)).toMatchObject({ allowed: true, reason: 'active' });
        expect(membershipAccessDecision(projection({ effectiveAt: new Date(NOW.getTime() + 1) }), NOW))
            .toMatchObject({ allowed: false, reason: 'pending' });
        expect(membershipAccessDecision(projection({ state: 'GRACE', graceUntil: new Date(NOW.getTime() + 1_000) }), NOW))
            .toMatchObject({ allowed: true, reason: 'grace' });
        expect(membershipAccessDecision(projection({ state: 'GRACE', graceUntil: NOW }), NOW))
            .toMatchObject({ allowed: false, reason: 'ended' });
        expect(membershipAccessDecision(projection({ state: 'CANCELLED_PENDING_END', paidThrough: new Date(NOW.getTime() + 1_000) }), NOW))
            .toMatchObject({ allowed: true, reason: 'paid-through' });
        expect(membershipAccessDecision(projection({ state: 'REFUNDED' }), NOW)).toMatchObject({ allowed: false });
    });

    it('hashes the canonical command independently from object identity', () => {
        expect(membershipCommandHash(command())).toBe(membershipCommandHash({ ...command() }));
        expect(membershipCommandHash(command({ membership_revision: 2 }))).not.toBe(membershipCommandHash(command()));
        expect(membershipCommandHash(command({ effective_at: '2026-08-06T12:00:00Z' })))
            .not.toBe(membershipCommandHash(command()));
    });

    it.each([
        'listener/1',
        '-listener',
        `a${'b'.repeat(128)}`,
    ])('rejects account IDs outside the canonical authority contract: %s', (accountId) => {
        expect(() => membershipCommandHash(command({ account_id: accountId })))
            .toThrow('account_id is invalid');
    });

    it('applies a new projection and replays the exact same revision', async () => {
        const expected = projection({ commandHash: membershipCommandHash(command()) });
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValueOnce(null);
        tx.earlyBirdMembershipProjection.create.mockResolvedValueOnce(expected);

        await expect(applyMembershipProjection(command())).resolves.toEqual({
            projection: expected,
            outcome: 'APPLIED',
        });

        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValueOnce(expected);
        await expect(applyMembershipProjection(command())).resolves.toMatchObject({
            outcome: 'REPLAYED',
        });
    });

    it('rejects two payloads claiming the same canonical revision', async () => {
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValueOnce(projection({ commandHash: 'b'.repeat(64) }));
        await expect(applyMembershipProjection(command())).rejects.toBeInstanceOf(EarlyBirdProjectionConflictError);
    });
});
