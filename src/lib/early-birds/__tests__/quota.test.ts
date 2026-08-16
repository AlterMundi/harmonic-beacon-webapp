import { describe, expect, it } from 'vitest';

import {
    advanceQuotaLedger,
    EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
    EARLY_BIRD_QUOTA_CYCLE_MS,
    continuousQuotaExhaustionAt,
    membershipFreeIntervals,
    quotaCycleAt,
    unionListeningIntervals,
    unstartedQuotaSnapshot,
    type QuotaBonusBucket,
} from '../quota';

const ANCHOR = new Date('2026-08-08T12:00:00.000Z');
const at = (offsetMs: number) => new Date(ANCHOR.getTime() + offsetMs);

function advance(input: {
    from?: number;
    through: number;
    intervals?: Array<[number, number]>;
    baseConsumedMs?: number;
    cycleStartedAt?: Date;
    bonuses?: QuotaBonusBucket[];
}) {
    return advanceQuotaLedger({
        anchorAt: ANCHOR,
        cycleStartedAt: input.cycleStartedAt ?? ANCHOR,
        baseConsumedMs: input.baseConsumedMs ?? 0,
        settledThrough: at(input.from ?? 0),
        through: at(input.through),
        listeningIntervals: (input.intervals ?? []).map(([start, end]) => ({
            startedAt: at(start),
            endedAt: at(end),
        })),
        bonuses: input.bonuses ?? [],
    });
}

describe('personal seven-day Listener quota ledger', () => {
    it('keeps access available without creating an anchor before LISTENING', () => {
        expect(unstartedQuotaSnapshot(ANCHOR)).toEqual(expect.objectContaining({
            policy: 'personal-7-day-v1',
            status: 'not-started',
            cycleStartedAt: null,
            cycleEndsAt: null,
            remainingMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            activelyConsuming: false,
            exhaustsAt: null,
            nextCycleAt: null,
        }));
    });

    it('uses immutable, exact half-open seven-day cadence boundaries', () => {
        expect(quotaCycleAt(ANCHOR, at(EARLY_BIRD_QUOTA_CYCLE_MS - 1))).toEqual({
            startedAt: ANCHOR,
            endsAt: at(EARLY_BIRD_QUOTA_CYCLE_MS),
        });
        expect(quotaCycleAt(ANCHOR, at(EARLY_BIRD_QUOTA_CYCLE_MS))).toEqual({
            startedAt: at(EARLY_BIRD_QUOTA_CYCLE_MS),
            endsAt: at(2 * EARLY_BIRD_QUOTA_CYCLE_MS),
        });
    });

    it('jumps dormant cycles without rollover or reanchoring', () => {
        const result = advance({ through: 4 * EARLY_BIRD_QUOTA_CYCLE_MS + 1234 });
        expect(result.cycleStartedAt).toEqual(at(4 * EARLY_BIRD_QUOTA_CYCLE_MS));
        expect(result.cycleEndsAt).toEqual(at(5 * EARLY_BIRD_QUOTA_CYCLE_MS));
        expect(result.baseConsumedMs).toBe(0);
        expect(result.usage).toEqual([]);
    });

    it('charges the union of overlapping leases once and preserves gaps', () => {
        const intervals = [
            { startedAt: at(0), endedAt: at(1_000) },
            { startedAt: at(500), endedAt: at(1_500) },
            { startedAt: at(2_000), endedAt: at(2_500) },
        ];
        expect(unionListeningIntervals(intervals, at(0), at(3_000))).toEqual([
            { startedAt: at(0), endedAt: at(1_500) },
            { startedAt: at(2_000), endedAt: at(2_500) },
        ]);
        const result = advance({
            through: 3_000,
            intervals: [[0, 1_000], [500, 1_500], [2_000, 2_500]],
        });
        expect(result.baseConsumedMs).toBe(2_000);
        expect(result.usage.reduce((sum, row) => sum + row.amountMs, 0)).toBe(2_000);
    });

    it('charges only the spans outside a future-effective membership interval', () => {
        const hour = 60 * 60 * 1_000;
        const projection = {
            state: 'ACTIVE',
            effectiveAt: at(hour),
            paidThrough: at(2 * hour),
            graceUntil: null,
        };

        expect(membershipFreeIntervals([
            { startedAt: ANCHOR, endedAt: at(3 * hour) },
        ], projection as never)).toEqual([
            { startedAt: ANCHOR, endedAt: at(hour) },
            { startedAt: at(2 * hour), endedAt: at(3 * hour) },
        ]);
        expect(membershipFreeIntervals([
            { startedAt: ANCHOR, endedAt: at(2 * hour) },
        ], { ...projection, paidThrough: null } as never)).toEqual([
            { startedAt: ANCHOR, endedAt: at(hour) },
        ]);
    });

    it('splits at a cycle boundary and gives the new cycle a full base', () => {
        const boundary = EARLY_BIRD_QUOTA_CYCLE_MS;
        const result = advance({
            from: boundary - 1,
            through: boundary + 1,
            intervals: [[boundary - 1, boundary + 1]],
            cycleStartedAt: ANCHOR,
        });
        expect(result.usage.map((row) => row.amountMs)).toEqual([1, 1]);
        expect(result.cycleStartedAt).toEqual(at(boundary));
        expect(result.baseConsumedMs).toBe(1);
    });

    it('allows exactly three hours, including the final millisecond, with no rollover', () => {
        const full = advance({
            through: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            intervals: [[0, EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS]],
        });
        expect(full.baseConsumedMs).toBe(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS);
        const exhausted = advance({
            from: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            through: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS + 1,
            intervals: [[EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS, EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS + 1]],
            baseConsumedMs: full.baseConsumedMs,
        });
        expect(exhausted.baseConsumedMs).toBe(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS);
        expect(exhausted.usage).toEqual([]);
    });

    it('allocates by earliest expiry and then stable bucket id', () => {
        const sameExpiry = at(60_000);
        const bonuses: QuotaBonusBucket[] = [
            { id: 'bbbbbbbb-0000-4000-8000-000000000000', amountMs: 10, consumedMs: 0, availableFrom: ANCHOR, expiresAt: sameExpiry },
            { id: 'aaaaaaaa-0000-4000-8000-000000000000', amountMs: 10, consumedMs: 0, availableFrom: ANCHOR, expiresAt: sameExpiry },
        ];
        const result = advance({ through: 15, intervals: [[0, 15]], bonuses });
        expect(result.usage[0].allocations).toEqual([
            expect.objectContaining({ bonusGrantId: bonuses[1].id, amountMs: 10 }),
            expect.objectContaining({ bonusGrantId: bonuses[0].id, amountMs: 5 }),
        ]);
        expect(result.baseConsumedMs).toBe(0);
    });

    it('expires a bonus without rewriting usage and falls back to base', () => {
        const bonus: QuotaBonusBucket = {
            id: 'aaaaaaaa-0000-4000-8000-000000000000',
            amountMs: 5,
            consumedMs: 0,
            availableFrom: ANCHOR,
            expiresAt: at(5),
        };
        const result = advance({ through: 10, intervals: [[0, 10]], bonuses: [bonus] });
        expect(result.bonusConsumedMs.get(bonus.id)).toBe(5);
        expect(result.baseConsumedMs).toBe(5);
        expect(result.usage.map((row) => row.amountMs)).toEqual([5, 5]);
    });

    it('caps predicted exhaustion at a short bonus expiry when base is exhausted', () => {
        const bonus: QuotaBonusBucket = {
            id: 'aaaaaaaa-0000-4000-8000-000000000000',
            amountMs: 60_000,
            consumedMs: 0,
            availableFrom: ANCHOR,
            expiresAt: at(10_000),
        };
        expect(continuousQuotaExhaustionAt({
            anchorAt: ANCHOR,
            cycleStartedAt: ANCHOR,
            baseConsumedMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            now: ANCHOR,
            bonuses: [bonus],
        })).toEqual(at(10_000));
    });

    it('does not shorten a funded horizon merely because a later bucket expires', () => {
        const bonus: QuotaBonusBucket = {
            id: 'aaaaaaaa-0000-4000-8000-000000000000',
            amountMs: 1_000,
            consumedMs: 0,
            availableFrom: ANCHOR,
            expiresAt: at(10_000),
        };
        expect(continuousQuotaExhaustionAt({
            anchorAt: ANCHOR,
            cycleStartedAt: ANCHOR,
            baseConsumedMs: 0,
            now: ANCHOR,
            bonuses: [bonus],
        })).toEqual(at(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS + 1_000));
    });

    it('keeps an unexpired unused bonus across dormant base cycles', () => {
        const cycleTwo = 2 * EARLY_BIRD_QUOTA_CYCLE_MS;
        const bonus: QuotaBonusBucket = {
            id: 'aaaaaaaa-0000-4000-8000-000000000000',
            amountMs: 1_000,
            consumedMs: 0,
            availableFrom: ANCHOR,
            expiresAt: null,
        };
        const result = advance({
            from: cycleTwo,
            through: cycleTwo + 1,
            intervals: [[cycleTwo, cycleTwo + 1]],
            cycleStartedAt: at(cycleTwo),
            baseConsumedMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            bonuses: [bonus],
        });
        expect(result.bonusConsumedMs.get(bonus.id)).toBe(1);
        expect(result.cycleStartedAt).toEqual(at(cycleTwo));
    });
});
