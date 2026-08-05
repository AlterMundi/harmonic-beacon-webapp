import { describe, expect, it } from 'vitest';

import {
    CONTRIBUTION_SUBMISSION_LIMIT,
    CONTRIBUTION_SUBMISSION_WINDOW_MS,
    SubmissionLimiter,
} from '@/lib/contribution-rate-limit';

describe('SubmissionLimiter (session contributions)', () => {
    it('accepts up to the limit inside the window, then limits', () => {
        const limiter = new SubmissionLimiter();
        const now = 1_000_000;
        for (let i = 0; i < CONTRIBUTION_SUBMISSION_LIMIT; i += 1) {
            expect(limiter.isLimited('s:p', now)).toBe(false);
            limiter.recordSubmission('s:p', now);
        }
        expect(limiter.isLimited('s:p', now)).toBe(true);
    });

    it('reports a positive retry hint only while limited', () => {
        const limiter = new SubmissionLimiter();
        const now = 1_000_000;
        expect(limiter.retryAfterSeconds('s:p', now)).toBe(0);
        for (let i = 0; i < CONTRIBUTION_SUBMISSION_LIMIT; i += 1) {
            limiter.recordSubmission('s:p', now);
        }
        const retry = limiter.retryAfterSeconds('s:p', now);
        expect(retry).toBeGreaterThan(0);
        expect(retry).toBeLessThanOrEqual(CONTRIBUTION_SUBMISSION_WINDOW_MS / 1000);
    });

    it('regains budget after the window slides past the oldest submission', () => {
        const limiter = new SubmissionLimiter();
        const now = 1_000_000;
        for (let i = 0; i < CONTRIBUTION_SUBMISSION_LIMIT; i += 1) {
            limiter.recordSubmission('s:p', now + i * 1000);
        }
        // All five submissions are still inside the window: limited.
        expect(limiter.isLimited('s:p', now + 4000)).toBe(true);
        // One millisecond after the oldest submission leaves the window only
        // three remain (submissions at +2s/+3s/+4s): budget regained.
        expect(limiter.isLimited('s:p', now + CONTRIBUTION_SUBMISSION_WINDOW_MS + 1)).toBe(false);
    });

    it('scopes budgets per key — one participant does not exhaust another', () => {
        const limiter = new SubmissionLimiter();
        const now = 1_000_000;
        for (let i = 0; i < CONTRIBUTION_SUBMISSION_LIMIT; i += 1) {
            limiter.recordSubmission('session-a:p1', now);
        }
        expect(limiter.isLimited('session-a:p1', now)).toBe(true);
        expect(limiter.isLimited('session-a:p2', now)).toBe(false);
        expect(limiter.isLimited('session-b:p1', now)).toBe(false);
    });

    it('reset clears one key or the whole limiter', () => {
        const limiter = new SubmissionLimiter();
        const now = 1_000_000;
        for (let i = 0; i < CONTRIBUTION_SUBMISSION_LIMIT; i += 1) {
            limiter.recordSubmission('s:p1', now);
            limiter.recordSubmission('s:p2', now);
        }
        limiter.reset('s:p1');
        expect(limiter.isLimited('s:p1', now)).toBe(false);
        expect(limiter.isLimited('s:p2', now)).toBe(true);
        limiter.reset();
        expect(limiter.isLimited('s:p2', now)).toBe(false);
    });

    it('bounds tracked keys under a spray across forged keys', () => {
        const limiter = new SubmissionLimiter(5, 60_000, 100);
        const now = 1_000_000;
        for (let i = 0; i < 500; i += 1) {
            limiter.recordSubmission(`s:p${i}`, now);
        }
        expect(limiter.submissionCount('s:p499', now)).toBeLessThanOrEqual(1);
        // The map is bounded; exact survivors are an implementation detail.
        let survivors = 0;
        for (let i = 0; i < 500; i += 1) {
            if (limiter.submissionCount(`s:p${i}`, now) > 0) survivors += 1;
        }
        expect(survivors).toBeLessThanOrEqual(100);
    });
});
