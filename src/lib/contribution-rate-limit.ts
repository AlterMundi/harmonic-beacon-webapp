/**
 * Submission limiter for session contributions (CHAT-01, #137).
 *
 * Same sliding-window mechanics and process-local caveat as the failed-login
 * `FailureLimiter` in `@/lib/rate-limit`: launch runs one app instance, and a
 * second instance would silently multiply the budget. The key is
 * (session, participant), never IP — several attendees can share one network,
 * so an IP budget would punish an entire household or venue for one flood.
 *
 * Counts accepted submissions only. Validation failures and idempotent
 * replays spend nothing; a burst of genuinely new messages exhausts the
 * window for that participant in that session.
 */

export const CONTRIBUTION_SUBMISSION_LIMIT = 5;
export const CONTRIBUTION_SUBMISSION_WINDOW_MS = 60 * 1000;

/** Ceiling on tracked keys, mirroring the failed-login limiter's backstop. */
const MAX_TRACKED_KEYS = 10_000;

export class SubmissionLimiter {
    private readonly submissions = new Map<string, number[]>();

    constructor(
        private readonly limit: number = CONTRIBUTION_SUBMISSION_LIMIT,
        private readonly windowMs: number = CONTRIBUTION_SUBMISSION_WINDOW_MS,
        private readonly maxTrackedKeys: number = MAX_TRACKED_KEYS,
    ) {}

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

    /** Test and support hook: forget one key, or all of them. */
    reset(key?: string): void {
        if (key === undefined) {
            this.submissions.clear();
            return;
        }
        this.submissions.delete(key);
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
