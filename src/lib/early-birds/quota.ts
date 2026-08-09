import { createHash, randomUUID } from 'node:crypto';

import type {
    EarlyBirdListeningBonusGrant,
    EarlyBirdListeningQuotaCursor,
    EarlyBirdMembershipProjection,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export const EARLY_BIRD_LISTENER_POLICY_VERSION = 'personal-7-day-v1' as const;
export const EARLY_BIRD_LISTENER_COMPATIBILITY_MARKER =
    'listener-authority:personal-7-day-v1-required' as const;
export const EARLY_BIRD_QUOTA_CYCLE_MS = 604_800_000;
export const EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS = 10_800_000;
export const EARLY_BIRD_QUOTA_MAX_BONUS_MS = 604_800_000;
export const EARLY_BIRD_QUOTA_MAX_ACTIVE_GRANTS = 128;

export type EarlyBirdQuotaStatus = 'not-started' | 'available' | 'listening' | 'exhausted';

export type EarlyBirdQuotaSnapshot = {
    policy: typeof EARLY_BIRD_LISTENER_POLICY_VERSION;
    status: EarlyBirdQuotaStatus;
    cycleStartedAt: Date | null;
    cycleEndsAt: Date | null;
    baseAllowanceMs: number;
    bonusAllowanceMs: number;
    consumedMs: number;
    remainingMs: number;
    activelyConsuming: boolean;
    exhaustsAt: Date | null;
    nextCycleAt: Date | null;
};

export type SerializedEarlyBirdQuotaSnapshot = {
    policy: typeof EARLY_BIRD_LISTENER_POLICY_VERSION;
    status: EarlyBirdQuotaStatus;
    cycleStartedAt: string | null;
    cycleEndsAt: string | null;
    baseAllowanceMs: number;
    bonusAllowanceMs: number;
    consumedMs: number;
    remainingMs: number;
    activelyConsuming: boolean;
    exhaustsAt: string | null;
    nextCycleAt: string | null;
};

export function serializeEarlyBirdQuotaSnapshot(
    snapshot: EarlyBirdQuotaSnapshot,
): SerializedEarlyBirdQuotaSnapshot {
    return {
        ...snapshot,
        cycleStartedAt: snapshot.cycleStartedAt?.toISOString() ?? null,
        cycleEndsAt: snapshot.cycleEndsAt?.toISOString() ?? null,
        exhaustsAt: snapshot.exhaustsAt?.toISOString() ?? null,
        nextCycleAt: snapshot.nextCycleAt?.toISOString() ?? null,
    };
}

export class EarlyBirdQuotaPolicyMismatchError extends Error {
    constructor() {
        super('Listener quota policy is not compatible with this application image');
        this.name = 'EarlyBirdQuotaPolicyMismatchError';
    }
}

export class EarlyBirdQuotaGrantInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EarlyBirdQuotaGrantInputError';
    }
}

export class EarlyBirdQuotaGrantConflictError extends Error {
    constructor() {
        super('Listener quota grant idempotency key conflicts with an earlier request');
        this.name = 'EarlyBirdQuotaGrantConflictError';
    }
}

type TransactionClient = Prisma.TransactionClient;
type QuotaCursorShape = Pick<
    EarlyBirdListeningQuotaCursor,
    'cycleAnchorAt' | 'cycleStartedAt' | 'cycleEndsAt' | 'baseConsumedMs' | 'settledThrough' | 'policyVersion'
>;

function membershipAllowed(
    projection: EarlyBirdMembershipProjection | null,
    now: Date,
): boolean {
    if (!projection) return false;
    if (projection.effectiveAt > now) return false;
    if (projection.state === 'ACTIVE') return projection.paidThrough === null || projection.paidThrough > now;
    if (projection.state === 'GRACE') return projection.graceUntil !== null && projection.graceUntil > now;
    if (projection.state === 'CANCELLED_PENDING_END') {
        return projection.paidThrough !== null && projection.paidThrough > now;
    }
    return false;
}

function quotaCanonicalize(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Cannot hash non-finite quota input');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(quotaCanonicalize).join(',')}]`;
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => (
            `${JSON.stringify(key)}:${quotaCanonicalize(record[key])}`
        )).join(',')}}`;
    }
    throw new Error('Unsupported quota request hash value');
}

export type QuotaBonusBucket = Pick<
    EarlyBirdListeningBonusGrant,
    'id' | 'amountMs' | 'availableFrom' | 'expiresAt'
> & { consumedMs: number };

export type ListeningInterval = { startedAt: Date; endedAt: Date };

export type QuotaAllocationDraft = {
    bucketKind: 'BASE' | 'BONUS';
    cycleStartedAt: Date | null;
    bonusGrantId: string | null;
    amountMs: number;
};

export type QuotaUsageDraft = ListeningInterval & {
    amountMs: number;
    allocations: QuotaAllocationDraft[];
};

export type AdvancedQuotaLedger = {
    cycleStartedAt: Date;
    cycleEndsAt: Date;
    baseConsumedMs: number;
    settledThrough: Date;
    bonusConsumedMs: Map<string, number>;
    usage: QuotaUsageDraft[];
};

export function quotaCycleAt(anchor: Date, at: Date): { startedAt: Date; endsAt: Date } {
    const elapsed = at.getTime() - anchor.getTime();
    if (elapsed < 0) throw new Error('Quota cycle cannot precede its anchor');
    const cycleIndex = Math.floor(elapsed / EARLY_BIRD_QUOTA_CYCLE_MS);
    const startedAt = new Date(anchor.getTime() + cycleIndex * EARLY_BIRD_QUOTA_CYCLE_MS);
    return { startedAt, endsAt: new Date(startedAt.getTime() + EARLY_BIRD_QUOTA_CYCLE_MS) };
}

export function unionListeningIntervals(
    intervals: ListeningInterval[],
    from: Date,
    through: Date,
): ListeningInterval[] {
    const clipped = intervals
        .map(({ startedAt, endedAt }) => ({
            startedAt: new Date(Math.max(startedAt.getTime(), from.getTime())),
            endedAt: new Date(Math.min(endedAt.getTime(), through.getTime())),
        }))
        .filter(({ startedAt, endedAt }) => endedAt > startedAt)
        .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
    const union: ListeningInterval[] = [];
    for (const interval of clipped) {
        const previous = union.at(-1);
        if (!previous || interval.startedAt > previous.endedAt) {
            union.push(interval);
        } else if (interval.endedAt > previous.endedAt) {
            previous.endedAt = interval.endedAt;
        }
    }
    return union;
}

function finiteMilliseconds(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
    return value;
}

/**
 * Pure fake-time ledger engine. Intervals must represent ordinary-Free time;
 * callers remove canonical-membership spans before invoking it.
 */
export function advanceQuotaLedger(input: {
    anchorAt: Date;
    cycleStartedAt: Date;
    baseConsumedMs: number;
    settledThrough: Date;
    through: Date;
    listeningIntervals: ListeningInterval[];
    bonuses: QuotaBonusBucket[];
}): AdvancedQuotaLedger {
    if (input.through < input.settledThrough) throw new Error('Quota settlement cannot move backwards');
    const baseByCycle = new Map<string, number>([[
        input.cycleStartedAt.toISOString(),
        Math.min(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS, finiteMilliseconds(input.baseConsumedMs, 'baseConsumedMs')),
    ]]);
    const bonusConsumedMs = new Map(input.bonuses.map((bonus) => [
        bonus.id,
        Math.min(bonus.amountMs, finiteMilliseconds(bonus.consumedMs, 'bonus consumedMs')),
    ]));
    const listening = unionListeningIntervals(
        input.listeningIntervals,
        input.settledThrough,
        input.through,
    );
    const usage: QuotaUsageDraft[] = [];

    for (const interval of listening) {
        let cursorMs = interval.startedAt.getTime();
        while (cursorMs < interval.endedAt.getTime()) {
            const cursorAt = new Date(cursorMs);
            const cycle = quotaCycleAt(input.anchorAt, cursorAt);
            const boundaryCandidates = [cycle.endsAt.getTime(), interval.endedAt.getTime()];
            for (const bonus of input.bonuses) {
                const available = bonus.availableFrom.getTime();
                const expires = bonus.expiresAt?.getTime();
                if (available > cursorMs && available < interval.endedAt.getTime()) boundaryCandidates.push(available);
                if (expires !== undefined && expires > cursorMs && expires < interval.endedAt.getTime()) {
                    boundaryCandidates.push(expires);
                }
            }
            const segmentEndMs = Math.min(...boundaryCandidates.filter((candidate) => candidate > cursorMs));
            const segmentMs = segmentEndMs - cursorMs;
            const cycleKey = cycle.startedAt.toISOString();
            const baseConsumed = baseByCycle.get(cycleKey) ?? 0;
            const buckets: Array<{
                kind: 'BASE' | 'BONUS';
                id: string;
                expiresAt: number;
                remainingMs: number;
                bonusGrantId: string | null;
            }> = [{
                kind: 'BASE',
                id: `base:${cycleKey}`,
                expiresAt: cycle.endsAt.getTime(),
                remainingMs: Math.max(0, EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS - baseConsumed),
                bonusGrantId: null,
            }];
            for (const bonus of input.bonuses) {
                if (bonus.availableFrom.getTime() > cursorMs) continue;
                if (bonus.expiresAt && bonus.expiresAt.getTime() <= cursorMs) continue;
                buckets.push({
                    kind: 'BONUS',
                    id: bonus.id,
                    expiresAt: bonus.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
                    remainingMs: Math.max(0, bonus.amountMs - (bonusConsumedMs.get(bonus.id) ?? 0)),
                    bonusGrantId: bonus.id,
                });
            }
            buckets.sort((left, right) => (
                left.expiresAt - right.expiresAt || left.id.localeCompare(right.id)
            ));

            let neededMs = segmentMs;
            const allocations: QuotaAllocationDraft[] = [];
            for (const bucket of buckets) {
                if (neededMs <= 0) break;
                const amountMs = Math.min(neededMs, bucket.remainingMs);
                if (amountMs <= 0) continue;
                allocations.push({
                    bucketKind: bucket.kind,
                    cycleStartedAt: bucket.kind === 'BASE' ? cycle.startedAt : null,
                    bonusGrantId: bucket.bonusGrantId,
                    amountMs,
                });
                if (bucket.kind === 'BASE') {
                    baseByCycle.set(cycleKey, (baseByCycle.get(cycleKey) ?? 0) + amountMs);
                } else {
                    bonusConsumedMs.set(bucket.id, (bonusConsumedMs.get(bucket.id) ?? 0) + amountMs);
                }
                neededMs -= amountMs;
            }
            const chargedMs = segmentMs - neededMs;
            if (chargedMs > 0) {
                usage.push({
                    startedAt: cursorAt,
                    endedAt: new Date(cursorMs + chargedMs),
                    amountMs: chargedMs,
                    allocations,
                });
            }
            cursorMs = segmentEndMs;
        }
    }

    const currentCycle = quotaCycleAt(input.anchorAt, input.through);
    return {
        cycleStartedAt: currentCycle.startedAt,
        cycleEndsAt: currentCycle.endsAt,
        baseConsumedMs: baseByCycle.get(currentCycle.startedAt.toISOString()) ?? 0,
        settledThrough: input.through,
        bonusConsumedMs,
        usage,
    };
}

function quotaSnapshot(input: {
    cursor: QuotaCursorShape | null;
    bonuses: QuotaBonusBucket[];
    now: Date;
    activelyListening: boolean;
}): EarlyBirdQuotaSnapshot {
    const activeBonuses = input.bonuses.filter((bonus) => (
        bonus.availableFrom <= input.now && (!bonus.expiresAt || bonus.expiresAt > input.now)
    ));
    const bonusAllowanceMs = activeBonuses.reduce((sum, bonus) => sum + bonus.amountMs, 0);
    const bonusConsumedMs = activeBonuses.reduce((sum, bonus) => sum + bonus.consumedMs, 0);
    if (!input.cursor?.cycleAnchorAt) {
        const remainingMs = EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS + bonusAllowanceMs - bonusConsumedMs;
        return {
            policy: EARLY_BIRD_LISTENER_POLICY_VERSION,
            status: 'not-started',
            cycleStartedAt: null,
            cycleEndsAt: null,
            baseAllowanceMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            bonusAllowanceMs,
            consumedMs: bonusConsumedMs,
            remainingMs: Math.max(0, remainingMs),
            activelyConsuming: false,
            exhaustsAt: null,
            nextCycleAt: null,
        };
    }
    const cycle = quotaCycleAt(input.cursor.cycleAnchorAt, input.now);
    const baseConsumedMs = input.cursor.cycleStartedAt?.getTime() === cycle.startedAt.getTime()
        ? input.cursor.baseConsumedMs
        : 0;
    const consumedMs = Math.max(0, baseConsumedMs + bonusConsumedMs);
    const remainingMs = Math.max(
        0,
        EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS + bonusAllowanceMs - consumedMs,
    );
    const activelyConsuming = input.activelyListening && remainingMs > 0;
    const exhaustsAt = activelyConsuming
        ? continuousQuotaExhaustionAt({
            anchorAt: input.cursor.cycleAnchorAt,
            cycleStartedAt: cycle.startedAt,
            baseConsumedMs,
            now: input.now,
            bonuses: activeBonuses,
        })
        : null;
    return {
        policy: EARLY_BIRD_LISTENER_POLICY_VERSION,
        status: remainingMs <= 0 ? 'exhausted' : activelyConsuming ? 'listening' : 'available',
        cycleStartedAt: cycle.startedAt,
        cycleEndsAt: cycle.endsAt,
        baseAllowanceMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
        bonusAllowanceMs,
        consumedMs,
        remainingMs,
        activelyConsuming,
        exhaustsAt,
        nextCycleAt: cycle.endsAt,
    };
}

/** Predicts the first unfunded millisecond of uninterrupted union listening. */
export function continuousQuotaExhaustionAt(input: {
    anchorAt: Date;
    cycleStartedAt: Date;
    baseConsumedMs: number;
    now: Date;
    bonuses: QuotaBonusBucket[];
}): Date {
    let timeMs = input.now.getTime();
    const bonusRemaining = new Map(input.bonuses.map((bonus) => [
        bonus.id,
        Math.max(0, bonus.amountMs - bonus.consumedMs),
    ]));
    let currentCycleKey = input.cycleStartedAt.toISOString();
    let baseRemaining = Math.max(0, EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS - input.baseConsumedMs);

    // Bounded amounts plus fixed weekly cadence converge quickly; the guard is
    // fail-closed if a future policy changes those bounds without this engine.
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
        const time = new Date(timeMs);
        const cycle = quotaCycleAt(input.anchorAt, time);
        const cycleKey = cycle.startedAt.toISOString();
        if (cycleKey !== currentCycleKey) {
            currentCycleKey = cycleKey;
            baseRemaining = EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS;
        }
        const buckets: Array<{ id: string; expiresAt: number; remainingMs: number }> = [{
            id: `base:${cycleKey}`,
            expiresAt: cycle.endsAt.getTime(),
            remainingMs: baseRemaining,
        }];
        let nextEventMs = cycle.endsAt.getTime();
        for (const bonus of input.bonuses) {
            const availableAt = bonus.availableFrom.getTime();
            const expiresAt = bonus.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
            if (availableAt > timeMs) {
                nextEventMs = Math.min(nextEventMs, availableAt);
                continue;
            }
            if (expiresAt <= timeMs) continue;
            nextEventMs = Math.min(nextEventMs, expiresAt);
            buckets.push({
                id: bonus.id,
                expiresAt,
                remainingMs: bonusRemaining.get(bonus.id) ?? 0,
            });
        }
        buckets.sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
        const fundedMs = buckets.reduce((sum, bucket) => sum + bucket.remainingMs, 0);
        if (fundedMs <= 0) return time;
        const untilEventMs = nextEventMs - timeMs;
        const consumeMs = Math.min(fundedMs, untilEventMs);
        let neededMs = consumeMs;
        for (const bucket of buckets) {
            if (neededMs <= 0) break;
            const amountMs = Math.min(neededMs, bucket.remainingMs);
            if (bucket.id.startsWith('base:')) baseRemaining -= amountMs;
            else bonusRemaining.set(bucket.id, (bonusRemaining.get(bucket.id) ?? 0) - amountMs);
            neededMs -= amountMs;
        }
        timeMs += consumeMs;
        if (consumeMs < untilEventMs) return new Date(timeMs);
    }
    throw new EarlyBirdQuotaPolicyMismatchError();
}

export function unstartedQuotaSnapshot(now: Date, bonuses: QuotaBonusBucket[] = []): EarlyBirdQuotaSnapshot {
    return quotaSnapshot({ cursor: null, bonuses, now, activelyListening: false });
}

export async function listenerQuotaDatabaseNow(tx: TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS "now"
    `;
    if (!rows[0]?.now) throw new Error('PostgreSQL clock unavailable');
    return rows[0].now;
}

export async function assertListenerQuotaPolicyCompatible(tx: TransactionClient): Promise<void> {
    const marker = await tx.earlyBirdListenerAuthorityPolicy.findUnique({ where: { id: 1 } });
    if (!marker || marker.policyVersion !== EARLY_BIRD_LISTENER_POLICY_VERSION) {
        throw new EarlyBirdQuotaPolicyMismatchError();
    }
}

export async function lockEarlyBirdQuotaAccount(
    tx: TransactionClient,
    accountId: string,
): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${accountId} FOR UPDATE`,
    );
    if (rows.length !== 1) throw new Error('EarlyBird account does not exist');
}

export function membershipFreeIntervals(
    intervals: ListeningInterval[],
    projection: EarlyBirdMembershipProjection | null,
): ListeningInterval[] {
    if (!projection) return intervals;
    const exemptStart = projection.effectiveAt;
    let exemptEnd: Date | null = null;
    if (projection.state === 'ACTIVE' || projection.state === 'CANCELLED_PENDING_END') {
        exemptEnd = projection.paidThrough;
    } else if (projection.state === 'GRACE') {
        exemptEnd = projection.graceUntil;
    } else {
        return intervals;
    }
    return intervals.flatMap((interval) => {
        const free: ListeningInterval[] = [];
        if (interval.startedAt < exemptStart) {
            free.push({
                startedAt: interval.startedAt,
                endedAt: interval.endedAt < exemptStart ? interval.endedAt : exemptStart,
            });
        }
        if (exemptEnd && interval.endedAt > exemptEnd) {
            free.push({
                startedAt: interval.startedAt > exemptEnd ? interval.startedAt : exemptEnd,
                endedAt: interval.endedAt,
            });
        }
        return free.filter((segment) => segment.endedAt > segment.startedAt);
    });
}

async function quotaBonuses(
    tx: TransactionClient,
    accountId: string,
    relevantAfter: Date,
): Promise<QuotaBonusBucket[]> {
    const grants = await tx.earlyBirdListeningBonusGrant.findMany({
        where: {
            accountId,
            fullyConsumed: false,
            OR: [{ expiresAt: null }, { expiresAt: { gt: relevantAfter } }],
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    return grants.map((grant) => ({ ...grant, consumedMs: Math.min(grant.amountMs, grant.consumedMs) }));
}

export async function settleLockedEarlyBirdQuota(input: {
    tx: TransactionClient;
    accountId: string;
    projection: EarlyBirdMembershipProjection | null;
    now: Date;
    observeFreeListening?: boolean;
}): Promise<EarlyBirdQuotaSnapshot> {
    await assertListenerQuotaPolicyCompatible(input.tx);
    let cursor = await input.tx.earlyBirdListeningQuotaCursor.findUnique({
        where: { accountId: input.accountId },
    });
    if (cursor && cursor.policyVersion !== EARLY_BIRD_LISTENER_POLICY_VERSION) {
        throw new EarlyBirdQuotaPolicyMismatchError();
    }
    const relevantAfter = cursor?.cycleAnchorAt
        ? cursor.settledThrough ?? cursor.cycleAnchorAt
        : input.now;
    const leases = await input.tx.earlyBirdStreamLease.findMany({
        where: {
            accountId: input.accountId,
            presence: 'LISTENING',
            evictedAt: null,
            presenceUpdatedAt: { lte: input.now },
            expiresAt: { gt: relevantAfter },
        },
        select: { presenceUpdatedAt: true, expiresAt: true },
    });
    const activelyListening = leases.some((lease) => lease.expiresAt > input.now)
        || input.observeFreeListening === true;
    const bonusesBefore = await quotaBonuses(input.tx, input.accountId, relevantAfter);
    if (!cursor?.cycleAnchorAt) {
        const ordinaryFree = !membershipAllowed(input.projection, input.now);
        if (!ordinaryFree || !activelyListening) {
            return quotaSnapshot({ cursor, bonuses: bonusesBefore, now: input.now, activelyListening: false });
        }
        const cycleEndsAt = new Date(input.now.getTime() + EARLY_BIRD_QUOTA_CYCLE_MS);
        cursor = await input.tx.earlyBirdListeningQuotaCursor.upsert({
            where: { accountId: input.accountId },
            create: {
                accountId: input.accountId,
                policyVersion: EARLY_BIRD_LISTENER_POLICY_VERSION,
                cycleAnchorAt: input.now,
                cycleStartedAt: input.now,
                cycleEndsAt,
                baseConsumedMs: 0,
                settledThrough: input.now,
            },
            update: {
                // The account lock makes this the only legal NULL -> instant
                // transition. No code path ever updates a non-NULL anchor.
                cycleAnchorAt: input.now,
                cycleStartedAt: input.now,
                cycleEndsAt,
                baseConsumedMs: 0,
                settledThrough: input.now,
            },
        });
        return quotaSnapshot({ cursor, bonuses: bonusesBefore, now: input.now, activelyListening: true });
    }

    const settledThrough = cursor.settledThrough ?? cursor.cycleAnchorAt;
    const rawIntervals = leases.map((lease) => ({
        startedAt: lease.presenceUpdatedAt ?? settledThrough,
        endedAt: lease.expiresAt < input.now ? lease.expiresAt : input.now,
    }));
    const ordinaryFreeIntervals = membershipFreeIntervals(rawIntervals, input.projection);
    const advanced = advanceQuotaLedger({
        anchorAt: cursor.cycleAnchorAt,
        cycleStartedAt: cursor.cycleStartedAt ?? quotaCycleAt(cursor.cycleAnchorAt, settledThrough).startedAt,
        baseConsumedMs: cursor.baseConsumedMs,
        settledThrough,
        through: input.now,
        listeningIntervals: ordinaryFreeIntervals,
        bonuses: bonusesBefore,
    });
    for (const bonus of bonusesBefore) {
        const consumedMs = advanced.bonusConsumedMs.get(bonus.id) ?? bonus.consumedMs;
        if (consumedMs !== bonus.consumedMs) {
            await input.tx.earlyBirdListeningBonusGrant.update({
                where: { id: bonus.id },
                data: { consumedMs, fullyConsumed: consumedMs === bonus.amountMs },
            });
        }
    }
    cursor = await input.tx.earlyBirdListeningQuotaCursor.update({
        where: { accountId: input.accountId },
        data: {
            cycleStartedAt: advanced.cycleStartedAt,
            cycleEndsAt: advanced.cycleEndsAt,
            baseConsumedMs: Math.min(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS, advanced.baseConsumedMs),
            settledThrough: advanced.settledThrough,
        },
    });
    const bonuses = bonusesBefore.map((bonus) => ({
        ...bonus,
        consumedMs: advanced.bonusConsumedMs.get(bonus.id) ?? bonus.consumedMs,
    }));
    return quotaSnapshot({
        cursor,
        bonuses,
        now: input.now,
        activelyListening: activelyListening && !membershipAllowed(input.projection, input.now),
    });
}

export async function withQuotaTransaction<T>(
    callback: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                return callback(tx);
            }, { isolationLevel: 'Serializable' });
        } catch (error) {
            const retryable = typeof error === 'object' && error !== null && 'code' in error
                && (error as { code?: unknown }).code === 'P2034';
            if (!retryable || attempt === 2) throw error;
            // Immediate retries can repeatedly collide with the short heartbeat
            // transaction that just won. A tiny bounded backoff lets media
            // authorization converge without turning transient contention into
            // a false access denial.
            await new Promise((resolve) => setTimeout(resolve, 8 * (attempt + 1)));
        }
    }
    throw new Error('Unreachable quota transaction retry state');
}

/** Account lock always precedes the authoritative clock read under contention. */
export function withLockedQuotaTransaction<T>(
    accountId: string,
    callback: (tx: TransactionClient, now: Date) => Promise<T>,
): Promise<T> {
    return withQuotaTransaction(async (tx) => {
        await lockEarlyBirdQuotaAccount(tx, accountId);
        const now = await listenerQuotaDatabaseNow(tx);
        return callback(tx, now);
    });
}

export const EARLY_BIRD_BONUS_ISSUERS = ['SUPPORT', 'OPERATIONS', 'MIGRATION', 'QUEST_SYSTEM'] as const;
export const EARLY_BIRD_BONUS_SOURCES = [
    'MANUAL_REMEDIATION', 'SERVICE_RECOVERY', 'POLICY_MIGRATION', 'COLLABORATION_QUEST',
] as const;
export const EARLY_BIRD_BONUS_REASONS = [
    'RESTORE_ACCESS', 'SERVICE_INTERRUPTION', 'CUTOVER_ADJUSTMENT', 'QUEST_COMPLETED',
] as const;

export type EarlyBirdQuotaBonusGrantInput = {
    accountId: string;
    amountMs: number;
    issuerCode: typeof EARLY_BIRD_BONUS_ISSUERS[number];
    sourceCode: typeof EARLY_BIRD_BONUS_SOURCES[number];
    reasonCode: typeof EARLY_BIRD_BONUS_REASONS[number];
    idempotencyKey: string;
    availableFrom: Date;
    expiresAt?: Date | null;
};

function normalizedBonusGrant(input: EarlyBirdQuotaBonusGrantInput) {
    if (!Number.isSafeInteger(input.amountMs) || input.amountMs < 1 || input.amountMs > EARLY_BIRD_QUOTA_MAX_BONUS_MS) {
        throw new EarlyBirdQuotaGrantInputError('amountMs is outside the allowed bound');
    }
    if (!EARLY_BIRD_BONUS_ISSUERS.includes(input.issuerCode)) throw new EarlyBirdQuotaGrantInputError('issuerCode is not allowed');
    if (!EARLY_BIRD_BONUS_SOURCES.includes(input.sourceCode)) throw new EarlyBirdQuotaGrantInputError('sourceCode is not allowed');
    if (!EARLY_BIRD_BONUS_REASONS.includes(input.reasonCode)) throw new EarlyBirdQuotaGrantInputError('reasonCode is not allowed');
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
        throw new EarlyBirdQuotaGrantInputError('idempotencyKey is invalid');
    }
    if (!Number.isFinite(input.availableFrom.getTime())) throw new EarlyBirdQuotaGrantInputError('availableFrom is invalid');
    if (input.expiresAt && (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= input.availableFrom)) {
        throw new EarlyBirdQuotaGrantInputError('expiresAt must be later than availableFrom');
    }
    return {
        accountId: input.accountId,
        amountMs: input.amountMs,
        issuerCode: input.issuerCode,
        sourceCode: input.sourceCode,
        reasonCode: input.reasonCode,
        idempotencyKey: input.idempotencyKey,
        availableFrom: input.availableFrom.toISOString(),
        expiresAt: input.expiresAt?.toISOString() ?? null,
    };
}

export function earlyBirdQuotaBonusRequestHash(input: EarlyBirdQuotaBonusGrantInput): string {
    return createHash('sha256').update(quotaCanonicalize(normalizedBonusGrant(input))).digest('hex');
}

/** Server-only library: intentionally has no HTTP route or browser input seam. */
export async function grantEarlyBirdQuotaBonus(
    input: EarlyBirdQuotaBonusGrantInput,
): Promise<{ grant: EarlyBirdListeningBonusGrant; replayed: boolean }> {
    const normalized = normalizedBonusGrant(input);
    const requestHash = earlyBirdQuotaBonusRequestHash(input);
    return withLockedQuotaTransaction(input.accountId, async (tx, now) => {
        await assertListenerQuotaPolicyCompatible(tx);
        const existing = await tx.earlyBirdListeningBonusGrant.findUnique({
            where: {
                accountId_issuerCode_idempotencyKey: {
                    accountId: input.accountId,
                    issuerCode: input.issuerCode,
                    idempotencyKey: input.idempotencyKey,
                },
            },
        });
        if (existing) {
            if (existing.requestHash !== requestHash) throw new EarlyBirdQuotaGrantConflictError();
            return { grant: existing, replayed: true };
        }
        const projection = await tx.earlyBirdMembershipProjection.findUnique({
            where: { accountId: input.accountId },
        });
        const activeGrantCount = await tx.earlyBirdListeningBonusGrant.count({
            where: {
                accountId: input.accountId,
                fullyConsumed: false,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
        });
        if (activeGrantCount >= EARLY_BIRD_QUOTA_MAX_ACTIVE_GRANTS) {
            throw new EarlyBirdQuotaGrantInputError('account has too many active bonus grants');
        }
        // A late grant cannot rewrite the interval before the server observed it.
        await settleLockedEarlyBirdQuota({ tx, accountId: input.accountId, projection, now });
        const grant = await tx.earlyBirdListeningBonusGrant.create({
            data: {
                id: randomUUID(),
                ...normalized,
                availableFrom: input.availableFrom,
                expiresAt: input.expiresAt ?? null,
                requestHash,
                grantedAt: now,
            },
        });
        return { grant, replayed: false };
    });
}
