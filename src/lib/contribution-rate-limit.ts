/**
 * Submission limiter for session contributions (CHAT-01, #137).
 *
 * Same sliding-window mechanics and process-local caveat as the failed-login
 * `FailureLimiter` in `@/lib/rate-limit`: launch runs one app instance, and a
 * second instance would silently multiply the budget. **This limiter is not
 * safe across multiple replicas** — the only inter-process guarantee is the
 * database's unique idempotency index. The key is (session, participant),
 * never IP: several attendees can share one network, so an IP budget would
 * punish an entire household or venue for one flood.
 *
 * Counts accepted submissions only. Validation failures and idempotent
 * replays spend nothing; a burst of genuinely new messages exhausts the
 * window for that participant in that session.
 *
 * ## Atomicity: decision and logical write share one critical section
 *
 * Checking `isLimited()` and calling `recordSubmission()` as separate steps
 * races: N concurrent requests all see budget before any of them records.
 * `withSlot()` therefore serializes the whole critical section per limiter
 * key — re-check idempotency, prune, decide, reserve, create, confirm or
 * release — so at most one request at a time reasons about one participant's
 * budget. Different keys never block each other, and idle locks are dropped
 * so the queue map cannot leak.
 *
 * Inside the callback the caller must:
 *
 *   1. re-verify idempotency (a twin request may have created the row while
 *      this one queued);
 *   2. bail out with `slot.isAvailable()` === false → 429 semantics;
 *   3. `slot.reserve()` **before** the INSERT;
 *   4. keep the reservation when a row is created;
 *   5. `slot.release()` when the INSERT fails, or when a P2002 turns out to
 *      be a replay/conflict — neither consumes budget.
 */

export const CONTRIBUTION_SUBMISSION_LIMIT = 5;
export const CONTRIBUTION_SUBMISSION_WINDOW_MS = 60 * 1000;

/** Ceiling on tracked keys, mirroring the failed-login limiter's backstop. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Handle for one serialized critical section. Valid only inside the
 * `withSlot` callback that created it.
 */
export interface SubmissionSlot {
    /** Budget left for this key right now (window already pruned). */
    isAvailable(): boolean;
    /** Seconds until the oldest submission leaves the window; 0 if not limited. */
    retryAfterSeconds(): number;
    /** Consume one budget slot. Kept unless `release()` runs. */
    reserve(): void;
    /** Return a previously reserved slot (failed write, replay, conflict). */
    release(): void;
}

export class SubmissionLimiter {
    private readonly submissions = new Map<string, number[]>();
    /** Tail promise of the per-key serialization chain. */
    private readonly locks = new Map<string, Promise<void>>();
    /** Live (queued or running) critical sections per key, for lock cleanup. */
    private readonly lockHolders = new Map<string, number>();

    constructor(
        private readonly limit: number = CONTRIBUTION_SUBMISSION_LIMIT,
        private readonly windowMs: number = CONTRIBUTION_SUBMISSION_WINDOW_MS,
        private readonly maxTrackedKeys: number = MAX_TRACKED_KEYS,
    ) {}

    /**
     * Runs `fn` with exclusive ownership of `key`'s budget decision. The
     * window is pruned before the callback runs, using `now` captured after
     * the lock is acquired (never the stale time of a queued request).
     */
    async withSlot<T>(key: string, fn: (slot: SubmissionSlot) => Promise<T>, now?: number): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let releaseLock!: () => void;
        const mine = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        this.locks.set(key, previous.then(() => mine));
        this.lockHolders.set(key, (this.lockHolders.get(key) ?? 0) + 1);

        await previous;
        try {
            const effectiveNow = now ?? Date.now();
            const recent = this.recent(key, effectiveNow);
            this.submissions.set(key, recent);

            let reservedAt: number | null = null;
            const slot: SubmissionSlot = {
                isAvailable: () => recent.length < this.limit,
                retryAfterSeconds: () => {
                    if (recent.length < this.limit) {
                        return 0;
                    }
                    const oldest = recent[0];
                    return Math.max(1, Math.ceil((oldest + this.windowMs - effectiveNow) / 1000));
                },
                reserve: () => {
                    if (reservedAt !== null) {
                        throw new Error('contribution slot already reserved');
                    }
                    reservedAt = effectiveNow;
                    recent.push(effectiveNow);
                    // Keep at most `limit` timestamps; anything older is
                    // already outside the decision (same guard as
                    // FailureLimiter.recordFailure).
                    if (recent.length > this.limit) {
                        recent.splice(0, recent.length - this.limit);
                    }
                    this.evictIfCrowded(effectiveNow);
                },
                release: () => {
                    if (reservedAt === null) {
                        return;
                    }
                    // The reservation is the newest timestamp this section
                    // pushed; the per-key lock guarantees nothing pushed after
                    // it, so lastIndexOf removes exactly our slot.
                    const index = recent.lastIndexOf(reservedAt);
                    if (index >= 0) {
                        recent.splice(index, 1);
                    }
                    reservedAt = null;
                },
            };

            return await fn(slot);
        } finally {
            releaseLock();
            const remaining = (this.lockHolders.get(key) ?? 1) - 1;
            if (remaining <= 0) {
                // Nobody queued behind us: drop the idle lock so the maps do
                // not grow one entry per participant forever.
                this.lockHolders.delete(key);
                this.locks.delete(key);
            } else {
                this.lockHolders.set(key, remaining);
            }
        }
    }

    /** Submissions recorded for `key` inside the current window. */
    submissionCount(key: string, now = Date.now()): number {
        const recent = this.recent(key, now);
        if (recent.length === 0) {
            this.submissions.delete(key);
            return 0;
        }
        this.submissions.set(key, recent);
        return recent.length;
    }

    isLimited(key: string, now = Date.now()): boolean {
        return this.submissionCount(key, now) >= this.limit;
    }

    recordSubmission(key: string, now = Date.now()): void {
        const recent = this.recent(key, now);
        recent.push(now);

        // Keep at most `limit` timestamps; anything older is already outside
        // the decision. See FailureLimiter.recordFailure for the same guard.
        if (recent.length > this.limit) {
            recent.splice(0, recent.length - this.limit);
        }

        this.submissions.set(key, recent);
        this.evictIfCrowded(now);
    }

    /** Seconds until `key` regains budget; 0 when it is not limited. */
    retryAfterSeconds(key: string, now = Date.now()): number {
        const recent = this.recent(key, now);
        if (recent.length < this.limit) {
            return 0;
        }
        const oldest = recent[0];
        return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    }

    /** Test and support hook: forget one key, or all keys, timestamps and locks. */
    reset(key?: string): void {
        if (key !== undefined) {
            this.submissions.delete(key);
            return;
        }
        this.submissions.clear();
        // Only idle locks are ever cleared here (tests run between suites);
        // live chains are left untouched by design.
        for (const lockKey of [...this.locks.keys()]) {
            if (!this.lockHolders.has(lockKey)) {
                this.locks.delete(lockKey);
            }
        }
        this.lockHolders.clear();
    }

    private recent(key: string, now: number): number[] {
        const cutoff = now - this.windowMs;
        return (this.submissions.get(key) ?? []).filter((at) => at > cutoff);
    }

    private evictIfCrowded(now: number): void {
        if (this.submissions.size <= this.maxTrackedKeys) {
            return;
        }

        const cutoff = now - this.windowMs;
        for (const [key, timestamps] of this.submissions) {
            if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
                this.submissions.delete(key);
            }
        }

        while (this.submissions.size > this.maxTrackedKeys) {
            const oldest = this.submissions.keys().next();
            if (oldest.done) {
                return;
            }
            this.submissions.delete(oldest.value);
        }
    }
}

/** Shared by every contribution creation route on the single app instance. */
export const contributionSubmissionLimiter = new SubmissionLimiter();
