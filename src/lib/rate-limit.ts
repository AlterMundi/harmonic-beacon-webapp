/**
 * Failed-login limiter for the weekend auth endpoints.
 *
 * Process-local on purpose. Launch runs exactly one app instance (docker
 * compose on mona), so one process holds the whole picture. Nginx/Cloudflare
 * provide the outer limit and are the only defence that survives a restart or a
 * second instance — if this app is ever scaled past one container, this counter
 * silently multiplies its budget by the instance count and must be replaced
 * with a shared store.
 *
 * Counts failures only. A legitimate attendee who mistypes a code twice and
 * then succeeds spends nothing; twenty wrong guesses from one client address
 * exhausts the budget for the rest of the window.
 */

export const AUTH_FAILURE_LIMIT = 20;
export const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Ceiling on tracked keys, so a spray across forged addresses cannot grow the
 * map without bound. Reaching it is already an attack; dropping the
 * least-recently-touched key loses a counter rather than the process.
 */
const MAX_TRACKED_KEYS = 10_000;

export class FailureLimiter {
    private readonly failures = new Map<string, number[]>();

    constructor(
        private readonly limit: number = AUTH_FAILURE_LIMIT,
        private readonly windowMs: number = AUTH_FAILURE_WINDOW_MS,
        private readonly maxTrackedKeys: number = MAX_TRACKED_KEYS,
    ) {}

    /** Failures recorded for `key` inside the current window. */
    failureCount(key: string, now = Date.now()): number {
        const recent = this.recent(key, now);
        if (recent.length === 0) {
            this.failures.delete(key);
            return 0;
        }
        this.failures.set(key, recent);
        return recent.length;
    }

    isLimited(key: string, now = Date.now()): boolean {
        return this.failureCount(key, now) >= this.limit;
    }

    recordFailure(key: string, now = Date.now()): void {
        const recent = this.recent(key, now);
        recent.push(now);

        // Keep at most `limit` timestamps. Anything older is already outside the
        // decision, and a client hammering the endpoint would otherwise grow an
        // unbounded array. Retaining the newest also means a persistent attacker
        // stays blocked until a full window after they stop.
        if (recent.length > this.limit) {
            recent.splice(0, recent.length - this.limit);
        }

        this.failures.set(key, recent);
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

    /** Test and support hook: forget one key, or all of them. */
    reset(key?: string): void {
        if (key === undefined) {
            this.failures.clear();
            return;
        }
        this.failures.delete(key);
    }

    private recent(key: string, now: number): number[] {
        const cutoff = now - this.windowMs;
        return (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    }

    private evictIfCrowded(now: number): void {
        if (this.failures.size <= this.maxTrackedKeys) {
            return;
        }

        const cutoff = now - this.windowMs;
        for (const [key, timestamps] of this.failures) {
            if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
                this.failures.delete(key);
            }
        }

        // Map iterates in insertion order, which is close enough to
        // least-recently-created for a backstop that only runs under attack.
        while (this.failures.size > this.maxTrackedKeys) {
            const oldest = this.failures.keys().next();
            if (oldest.done) {
                return;
            }
            this.failures.delete(oldest.value);
        }
    }
}

/**
 * Shared across `/api/auth/ticket` and `/api/auth/staff`: one budget per client
 * address, not one per endpoint, so guessing cannot be doubled by alternating
 * between the two.
 */
export const authFailureLimiter = new FailureLimiter();
