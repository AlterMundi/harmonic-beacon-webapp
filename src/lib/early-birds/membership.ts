import { createHash } from 'node:crypto';

import type {
    EarlyBirdMembershipProjection,
    EarlyBirdMembershipSource,
    EarlyBirdMembershipState,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import { isEarlyBirdAccountId } from './account-id';
import {
    assertListenerQuotaPolicyCompatible,
    listenerQuotaDatabaseNow,
    settleLockedEarlyBirdQuota,
} from './quota';

export const EARLY_BIRDS_FOUNDERS_OFFER = 'EARLY_BIRDS_FOUNDERS_V1' as const;

export type EarlyBirdFounderContinuity = {
    episode_id: string;
    revision: number;
    state: 'ACTIVE' | 'CANCELLED_PENDING_END' | 'GRACE' | 'ENDED';
    offer: { code: typeof EARLY_BIRDS_FOUNDERS_OFFER; revision: number };
    canonical_price: { currency: 'USD'; amount_minor: 500 };
    billing_period: 'MONTHLY';
    activated_at: string;
    service_through: string | null;
    ended_at: string | null;
    terminal_reason: string | null;
};

export type EarlyBirdMembershipProjectionCommand = {
    schema_version: 'early-bird-membership.command.v2';
    account_id: string;
    membership_revision: number;
    state: EarlyBirdMembershipState;
    source: EarlyBirdMembershipSource | null;
    offer: { code: typeof EARLY_BIRDS_FOUNDERS_OFFER; revision: number } | null;
    effective_at: string;
    paid_through: string | null;
    grace_until: string | null;
    provider: 'paypal' | 'mercado_pago' | null;
    current_price: { currency: 'USD' | 'ARS'; amount_minor: number } | null;
    reason_code: string;
    founder_continuity: EarlyBirdFounderContinuity | null;
};

export type EarlyBirdProjectionOutcome = 'APPLIED' | 'REPLAYED' | 'STALE';

export type EarlyBirdAccessDecision = {
    allowed: boolean;
    reason: 'active' | 'grace' | 'paid-through' | 'pending' | 'ended' | 'missing';
    projection: EarlyBirdMembershipProjection | null;
};

export class EarlyBirdProjectionConflictError extends Error {
    constructor() {
        super('Membership revision already exists with a different payload');
        this.name = 'EarlyBirdProjectionConflictError';
    }
}

function assertFounderContinuityTransition(
    existing: EarlyBirdMembershipProjection,
    next: EarlyBirdFounderContinuity | null,
): void {
    if (existing.founderContinuityEpisodeId === null) return;
    if (next === null || next.episode_id !== existing.founderContinuityEpisodeId
        || existing.founderContinuityRevision === null
        || next.revision < existing.founderContinuityRevision) {
        throw new EarlyBirdProjectionConflictError();
    }
    const sameInstant = (stored: Date | null, wire: string | null) => (
        stored === null ? wire === null : wire !== null && stored.toISOString() === new Date(wire).toISOString()
    );
    const immutableEpisodeFacts = existing.founderContinuityOfferCode === next.offer.code
        && existing.founderContinuityOfferRevision === next.offer.revision
        && existing.founderContinuityCurrency === next.canonical_price.currency
        && existing.founderContinuityAmountMinor === next.canonical_price.amount_minor
        && existing.founderContinuityBillingPeriod === next.billing_period
        && sameInstant(existing.founderContinuityActivatedAt, next.activated_at);
    if (!immutableEpisodeFacts) throw new EarlyBirdProjectionConflictError();

    if (existing.founderContinuityState === 'ENDED') {
        const exactTombstone = next.state === 'ENDED'
            && sameInstant(existing.founderContinuityServiceThrough, next.service_through)
            && sameInstant(existing.founderContinuityEndedAt, next.ended_at)
            && existing.founderContinuityTerminalReason === next.terminal_reason;
        if (!exactTombstone) throw new EarlyBirdProjectionConflictError();
        return;
    }
    if (next.state === 'ENDED' && next.revision === existing.founderContinuityRevision) {
        throw new EarlyBirdProjectionConflictError();
    }
    if (next.revision === existing.founderContinuityRevision) {
        const exact = existing.founderContinuityState === next.state
            && sameInstant(existing.founderContinuityServiceThrough, next.service_through)
            && sameInstant(existing.founderContinuityEndedAt, next.ended_at)
            && existing.founderContinuityTerminalReason === next.terminal_reason;
        if (!exact) throw new EarlyBirdProjectionConflictError();
    }
}

function normalizedInstant(value: string, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        throw new Error(`${field} must be an RFC 3339 date-time`);
    }
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new Error(`${field} must be an RFC 3339 date-time`);
    // Keep the validated wire string: JCS hashes exact field values, so
    // semantically equal but lexically different date strings must conflict.
    return value;
}

function normalizedCommand(command: EarlyBirdMembershipProjectionCommand): EarlyBirdMembershipProjectionCommand {
    if (command.schema_version !== 'early-bird-membership.command.v2') {
        throw new Error('Unsupported membership command schema');
    }
    if (!isEarlyBirdAccountId(command.account_id)) throw new Error('account_id is invalid');
    if (!Number.isSafeInteger(command.membership_revision) || command.membership_revision < 1) {
        throw new Error('membership_revision must be a positive integer');
    }
    if (command.offer && (
        command.offer.code !== EARLY_BIRDS_FOUNDERS_OFFER ||
        !Number.isSafeInteger(command.offer.revision) || command.offer.revision < 1
    )) throw new Error('offer is invalid');
    if (command.current_price && (
        !['USD', 'ARS'].includes(command.current_price.currency) ||
        !Number.isSafeInteger(command.current_price.amount_minor) ||
        command.current_price.amount_minor < 1
    )) throw new Error('current_price is invalid');
    if (!command.reason_code || command.reason_code.length > 64) throw new Error('reason_code is invalid');

    const continuity = command.founder_continuity;
    if (continuity !== null) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(continuity.episode_id)) {
            throw new Error('founder_continuity.episode_id is invalid');
        }
        if (!Number.isSafeInteger(continuity.revision) || continuity.revision < 1) {
            throw new Error('founder_continuity.revision is invalid');
        }
        if (!['ACTIVE', 'CANCELLED_PENDING_END', 'GRACE', 'ENDED'].includes(continuity.state)) {
            throw new Error('founder_continuity.state is invalid');
        }
        if (
            continuity.offer.code !== EARLY_BIRDS_FOUNDERS_OFFER
            || !Number.isSafeInteger(continuity.offer.revision)
            || continuity.offer.revision < 1
            || continuity.canonical_price.currency !== 'USD'
            || continuity.canonical_price.amount_minor !== 500
            || continuity.billing_period !== 'MONTHLY'
        ) {
            throw new Error('founder_continuity offer is invalid');
        }
        if (continuity.state === 'ENDED') {
            if (continuity.ended_at === null || continuity.terminal_reason === null
                || continuity.terminal_reason.length < 1 || continuity.terminal_reason.length > 64) {
                throw new Error('ended founder_continuity is incomplete');
            }
        } else if (continuity.ended_at !== null || continuity.terminal_reason !== null) {
            throw new Error('current founder_continuity cannot carry terminal evidence');
        } else if (continuity.service_through === null) {
            throw new Error('current founder_continuity lacks a service boundary');
        }
    }

    const normalized: EarlyBirdMembershipProjectionCommand = {
        ...command,
        effective_at: normalizedInstant(command.effective_at, 'effective_at'),
        paid_through: command.paid_through === null
            ? null
            : normalizedInstant(command.paid_through, 'paid_through'),
        grace_until: command.grace_until === null
            ? null
            : normalizedInstant(command.grace_until, 'grace_until'),
        founder_continuity: continuity === null ? null : {
            ...continuity,
            activated_at: normalizedInstant(continuity.activated_at, 'founder_continuity.activated_at'),
            service_through: continuity.service_through === null
                ? null
                : normalizedInstant(continuity.service_through, 'founder_continuity.service_through'),
            ended_at: continuity.ended_at === null
                ? null
                : normalizedInstant(continuity.ended_at, 'founder_continuity.ended_at'),
        },
    };
    const paid = normalized.source === 'PAYPAL' || normalized.source === 'MERCADO_PAGO';
    const current = normalized.state === 'ACTIVE'
        || normalized.state === 'GRACE'
        || normalized.state === 'CANCELLED_PENDING_END';
    if (normalized.founder_continuity === null) {
        if (paid && current) throw new Error('Paid service is missing canonical Founder continuity');
        return normalized;
    }
    if (!paid || normalized.offer === null
        || normalized.offer.code !== normalized.founder_continuity.offer.code
        || normalized.offer.revision !== normalized.founder_continuity.offer.revision) {
        throw new Error('Founder continuity contradicts current membership');
    }
    if (normalized.founder_continuity.state === 'ENDED') {
        if (current) throw new Error('Ended Founder continuity cannot accompany current service');
        return normalized;
    }
    if (normalized.state !== normalized.founder_continuity.state) {
        throw new Error('Current Founder continuity contradicts membership state');
    }
    const boundary = normalized.founder_continuity.state === 'GRACE'
        ? normalized.grace_until
        : normalized.paid_through;
    if (normalized.founder_continuity.service_through === null || boundary === null
        || Date.parse(normalized.founder_continuity.service_through) !== Date.parse(boundary)) {
        throw new Error('Founder continuity boundary contradicts membership');
    }
    return normalized;
}

/** RFC 8785 is intentionally small here: the contract contains only objects, strings, nulls and integers. */
export function jcsCanonicalize(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('JCS cannot encode a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`;
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => (
            `${JSON.stringify(key)}:${jcsCanonicalize(record[key])}`
        )).join(',')}}`;
    }
    throw new Error('JCS cannot encode this value');
}

export function membershipCommandHash(command: EarlyBirdMembershipProjectionCommand): string {
    return createHash('sha256').update(jcsCanonicalize(normalizedCommand(command))).digest('hex');
}

export function membershipAccessDecision(
    projection: EarlyBirdMembershipProjection | null,
    now = new Date(),
): EarlyBirdAccessDecision {
    if (!projection) return { allowed: false, reason: 'missing', projection };
    if (projection.effectiveAt > now) {
        return { allowed: false, reason: 'pending', projection };
    }

    const paid = projection.source === 'PAYPAL' || projection.source === 'MERCADO_PAGO';
    if (paid) {
        const currentContinuity = projection.founderContinuityState === projection.state
            && projection.founderContinuityEpisodeId !== null
            && projection.founderContinuityOfferCode === EARLY_BIRDS_FOUNDERS_OFFER
            && projection.founderContinuityOfferCode === projection.offerCode
            && projection.founderContinuityOfferRevision === projection.offerRevision
            && projection.founderContinuityCurrency === 'USD'
            && projection.founderContinuityAmountMinor === 500
            && projection.founderContinuityBillingPeriod === 'MONTHLY'
            && projection.founderContinuityActivatedAt !== null;
        if (!currentContinuity) return { allowed: false, reason: 'ended', projection };
        const boundary = projection.state === 'GRACE' ? projection.graceUntil : projection.paidThrough;
        if (projection.founderContinuityServiceThrough?.getTime() !== boundary?.getTime()) {
            return { allowed: false, reason: 'ended', projection };
        }
    }

    if (projection.state === 'ACTIVE') {
        const allowed = projection.paidThrough === null || projection.paidThrough > now;
        return { allowed, reason: allowed ? 'active' : 'ended', projection };
    }
    if (projection.state === 'GRACE') {
        const allowed = projection.graceUntil !== null && projection.graceUntil > now;
        return { allowed, reason: allowed ? 'grace' : 'ended', projection };
    }
    if (projection.state === 'CANCELLED_PENDING_END') {
        const allowed = projection.paidThrough !== null && projection.paidThrough > now;
        return { allowed, reason: allowed ? 'paid-through' : 'ended', projection };
    }
    if (projection.state === 'PENDING') return { allowed: false, reason: 'pending', projection };
    return { allowed: false, reason: 'ended', projection };
}

export async function getEarlyBirdAccess(
    accountId: string,
    now = new Date(),
): Promise<EarlyBirdAccessDecision> {
    const projection = await prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
    return membershipAccessDecision(projection, now);
}

export async function applyMembershipProjection(
    rawCommand: EarlyBirdMembershipProjectionCommand,
    options: { synthetic?: boolean } = {},
): Promise<{ projection: EarlyBirdMembershipProjection; outcome: EarlyBirdProjectionOutcome }> {
    const command = normalizedCommand(rawCommand);
    const commandHash = membershipCommandHash(command);
    const synthetic = options.synthetic === true;

    return prisma.$transaction(async (tx) => {
        const accountRows = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${command.account_id} FOR UPDATE`,
        );
        if (accountRows.length !== 1) throw new Error('EarlyBird account does not exist');

        await assertListenerQuotaPolicyCompatible(tx);
        // The account lock must be acquired before observing authoritative time;
        // otherwise lock contention could make the settlement clock stale.
        const observedAt = await listenerQuotaDatabaseNow(tx);

        const existing = await tx.earlyBirdMembershipProjection.findUnique({
            where: { accountId: command.account_id },
        });
        await settleLockedEarlyBirdQuota({
            tx,
            accountId: command.account_id,
            projection: existing,
            now: observedAt,
        });
        if (synthetic && existing && !existing.synthetic) {
            throw new Error('Synthetic access cannot replace a canonical membership');
        }
        // A synthetic test row is outside the canonical revision sequence and may be replaced.
        if (existing && !existing.synthetic && existing.revision > command.membership_revision) {
            return { projection: existing, outcome: 'STALE' };
        }
        if (existing && !existing.synthetic && existing.revision === command.membership_revision) {
            if (existing.commandHash !== commandHash) throw new EarlyBirdProjectionConflictError();
            return { projection: existing, outcome: 'REPLAYED' };
        }
        if (existing && !existing.synthetic) {
            assertFounderContinuityTransition(existing, command.founder_continuity);
        }

        const data = {
            revision: command.membership_revision,
            commandHash,
            state: command.state,
            source: command.source,
            offerCode: command.offer?.code ?? null,
            offerRevision: command.offer?.revision ?? null,
            effectiveAt: new Date(command.effective_at),
            paidThrough: command.paid_through ? new Date(command.paid_through) : null,
            graceUntil: command.grace_until ? new Date(command.grace_until) : null,
            provider: command.provider,
            amountMinor: command.current_price?.amount_minor ?? null,
            currency: command.current_price?.currency ?? null,
            reasonCode: command.reason_code,
            founderContinuityEpisodeId: command.founder_continuity?.episode_id ?? null,
            founderContinuityRevision: command.founder_continuity?.revision ?? null,
            founderContinuityState: command.founder_continuity?.state ?? null,
            founderContinuityOfferCode: command.founder_continuity?.offer.code ?? null,
            founderContinuityOfferRevision: command.founder_continuity?.offer.revision ?? null,
            founderContinuityCurrency: command.founder_continuity?.canonical_price.currency ?? null,
            founderContinuityAmountMinor: command.founder_continuity?.canonical_price.amount_minor ?? null,
            founderContinuityBillingPeriod: command.founder_continuity?.billing_period ?? null,
            founderContinuityActivatedAt: command.founder_continuity
                ? new Date(command.founder_continuity.activated_at)
                : null,
            founderContinuityServiceThrough: command.founder_continuity?.service_through
                ? new Date(command.founder_continuity.service_through)
                : null,
            founderContinuityEndedAt: command.founder_continuity?.ended_at
                ? new Date(command.founder_continuity.ended_at)
                : null,
            founderContinuityTerminalReason: command.founder_continuity?.terminal_reason ?? null,
            synthetic,
        };
        const projection = existing
            ? await tx.earlyBirdMembershipProjection.update({
                where: { accountId: command.account_id },
                data,
            })
            : await tx.earlyBirdMembershipProjection.create({
                data: { accountId: command.account_id, ...data },
            });
        // If this command removes unlimited access while a lease is already
        // LISTENING, that server-observed transition is the first legal anchor.
        await settleLockedEarlyBirdQuota({
            tx,
            accountId: command.account_id,
            projection,
            now: observedAt,
        });
        return { projection, outcome: 'APPLIED' };
    });
}

/** Test-only entitlement. It carries no canonical source and never replaces a real projection. */
export async function issueSyntheticMembership(accountId: string, now = new Date()) {
    const existing = await prisma.earlyBirdMembershipProjection.findUnique({
        where: { accountId },
        select: { revision: true, synthetic: true },
    });
    if (existing && !existing.synthetic) throw new Error('Synthetic access cannot replace a canonical membership');
    return applyMembershipProjection({
        schema_version: 'early-bird-membership.command.v2',
        account_id: accountId,
        membership_revision: (existing?.revision ?? 0) + 1,
        state: 'ACTIVE',
        source: null,
        offer: { code: EARLY_BIRDS_FOUNDERS_OFFER, revision: 1 },
        effective_at: now.toISOString(),
        paid_through: null,
        grace_until: null,
        provider: null,
        current_price: null,
        reason_code: 'SYNTHETIC_TEST_ACCESS',
        founder_continuity: null,
    }, { synthetic: true });
}
