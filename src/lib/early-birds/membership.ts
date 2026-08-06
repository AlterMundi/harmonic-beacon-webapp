import { createHash } from 'node:crypto';

import type {
    EarlyBirdMembershipProjection,
    EarlyBirdMembershipSource,
    EarlyBirdMembershipState,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import { isEarlyBirdAccountId } from './account-id';

export const EARLY_BIRDS_FOUNDERS_OFFER = 'EARLY_BIRDS_FOUNDERS_V1' as const;

export type EarlyBirdMembershipProjectionCommand = {
    schema_version: 'early-bird-membership.command.v1';
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
    if (command.schema_version !== 'early-bird-membership.command.v1') {
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

    return {
        ...command,
        effective_at: normalizedInstant(command.effective_at, 'effective_at'),
        paid_through: command.paid_through === null
            ? null
            : normalizedInstant(command.paid_through, 'paid_through'),
        grace_until: command.grace_until === null
            ? null
            : normalizedInstant(command.grace_until, 'grace_until'),
    };
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

        const existing = await tx.earlyBirdMembershipProjection.findUnique({
            where: { accountId: command.account_id },
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
        schema_version: 'early-bird-membership.command.v1',
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
    }, { synthetic: true });
}
