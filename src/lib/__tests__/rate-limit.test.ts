import { describe, expect, it } from 'vitest';

import {
    AUTH_FAILURE_LIMIT,
    AUTH_FAILURE_WINDOW_MS,
    FailureLimiter,
    authFailureLimiter,
} from '../rate-limit';

const START = new Date('2026-08-01T18:00:00.000Z').getTime();

describe('FailureLimiter', () => {
    it('blocks only after the configured number of failures', () => {
        const limiter = new FailureLimiter(3, 60_000);

        expect(limiter.isLimited('client', START)).toBe(false);
        limiter.recordFailure('client', START);
        limiter.recordFailure('client', START + 1);
        expect(limiter.isLimited('client', START + 2)).toBe(false);

        limiter.recordFailure('client', START + 2);
        expect(limiter.isLimited('client', START + 3)).toBe(true);
    });

    it('keeps each client address on its own budget', () => {
        const limiter = new FailureLimiter(2, 60_000);
        limiter.recordFailure('a', START);
        limiter.recordFailure('a', START);

        expect(limiter.isLimited('a', START)).toBe(true);
        expect(limiter.isLimited('b', START)).toBe(false);
    });

    it('forgets failures once they leave the window', () => {
        const limiter = new FailureLimiter(2, 60_000);
        limiter.recordFailure('client', START);
        limiter.recordFailure('client', START + 1);
        expect(limiter.isLimited('client', START + 59_000)).toBe(true);

        // Failures age out one at a time, so budget returns gradually rather than
        // all at once when the window ends.
        expect(limiter.failureCount('client', START + 60_000)).toBe(1);
        expect(limiter.isLimited('client', START + 60_000)).toBe(false);
        expect(limiter.failureCount('client', START + 60_002)).toBe(0);
    });

    it('reports how long a blocked client must wait', () => {
        const limiter = new FailureLimiter(2, 60_000);
        expect(limiter.retryAfterSeconds('client', START)).toBe(0);

        limiter.recordFailure('client', START);
        limiter.recordFailure('client', START + 10_000);
        expect(limiter.retryAfterSeconds('client', START + 10_000)).toBe(50);
    });

    it('keeps a client hammering the endpoint blocked rather than growing its history', () => {
        const limiter = new FailureLimiter(2, 60_000);
        for (let attempt = 0; attempt < 50; attempt += 1) {
            limiter.recordFailure('client', START + attempt * 100);
        }

        // Only the newest `limit` failures are retained, and they are the ones
        // that decide: the window runs from the most recent attempts, not the
        // first two.
        expect(limiter.failureCount('client', START + 5_000)).toBe(2);
        expect(limiter.isLimited('client', START + 5_000)).toBe(true);
        // Measured from the 49th failure (START + 4_800), not the first.
        expect(limiter.retryAfterSeconds('client', START + 5_000)).toBe(60);
    });

    it('bounds the number of tracked keys under a spray', () => {
        const limiter = new FailureLimiter(5, 60_000, 4);
        for (let index = 0; index < 100; index += 1) {
            limiter.recordFailure(`client-${index}`, START + index);
        }

        // The most recent key must still be counted; older ones may be evicted.
        expect(limiter.failureCount('client-99', START + 100)).toBe(1);
        expect(limiter.failureCount('client-0', START + 100)).toBe(0);
    });

    it('resets one key or all of them', () => {
        const limiter = new FailureLimiter(1, 60_000);
        limiter.recordFailure('a', START);
        limiter.recordFailure('b', START);

        limiter.reset('a');
        expect(limiter.isLimited('a', START)).toBe(false);
        expect(limiter.isLimited('b', START)).toBe(true);

        limiter.reset();
        expect(limiter.isLimited('b', START)).toBe(false);
    });
});

describe('authFailureLimiter', () => {
    it('carries the weekend budget: twenty failures per ten minutes', () => {
        expect(AUTH_FAILURE_LIMIT).toBe(20);
        expect(AUTH_FAILURE_WINDOW_MS).toBe(10 * 60 * 1000);

        for (let attempt = 0; attempt < AUTH_FAILURE_LIMIT - 1; attempt += 1) {
            authFailureLimiter.recordFailure('shared-budget-client', START);
        }
        expect(authFailureLimiter.isLimited('shared-budget-client', START)).toBe(false);

        authFailureLimiter.recordFailure('shared-budget-client', START);
        expect(authFailureLimiter.isLimited('shared-budget-client', START)).toBe(true);

        authFailureLimiter.reset('shared-budget-client');
    });
});
