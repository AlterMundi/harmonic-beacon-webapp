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

    describe('withSlot — atomic decision + reservation per key', () => {
        it('serializes the critical section per key', async () => {
            const limiter = new SubmissionLimiter();
            const events: string[] = [];
            const section = (name: string) => async () => {
                events.push(`enter-${name}`);
                await new Promise((resolve) => setTimeout(resolve, 5));
                events.push(`exit-${name}`);
            };

            await Promise.all([
                limiter.withSlot('s:p', section('a'), 1000),
                limiter.withSlot('s:p', section('b'), 1000),
            ]);

            // One section fully completes before the other starts.
            expect(events).toEqual(['enter-a', 'exit-a', 'enter-b', 'exit-b']);
        });

        it('six concurrent reservations see exactly five slots: the sixth is unavailable', async () => {
            const limiter = new SubmissionLimiter();
            const outcomes = await Promise.all(
                Array.from({ length: 6 }, () =>
                    limiter.withSlot('s:p', async (slot) => {
                        if (!slot.isAvailable()) {
                            return 'limited';
                        }
                        slot.reserve();
                        return 'reserved';
                    }, 1000)),
            );

            expect(outcomes.filter((o) => o === 'reserved')).toHaveLength(5);
            expect(outcomes.filter((o) => o === 'limited')).toHaveLength(1);
            expect(limiter.submissionCount('s:p', 1001)).toBe(5);
        });

        it('does not serialize different keys against each other', async () => {
            const limiter = new SubmissionLimiter();
            const events: string[] = [];
            const section = (name: string, key: string) => limiter.withSlot(key, async () => {
                events.push(`enter-${name}`);
                await new Promise((resolve) => setTimeout(resolve, 5));
                events.push(`exit-${name}`);
            }, 1000);

            await Promise.all([section('a', 's:p1'), section('b', 's:p2')]);

            // Both sections overlapped: b entered before a exited.
            expect(events).toEqual(['enter-a', 'enter-b', 'exit-a', 'exit-b']);
        });

        it('release() returns a reserved slot', async () => {
            const limiter = new SubmissionLimiter();
            await limiter.withSlot('s:p', async (slot) => {
                slot.reserve();
                slot.release();
            }, 1000);

            expect(limiter.submissionCount('s:p', 1001)).toBe(0);
        });

        it('double-reserving inside one section is a programming error', async () => {
            const limiter = new SubmissionLimiter();
            await expect(
                limiter.withSlot('s:p', async (slot) => {
                    slot.reserve();
                    slot.reserve();
                }, 1000),
            ).rejects.toThrowError('already reserved');
        });

        it('reports retryAfterSeconds inside the slot when limited', async () => {
            const limiter = new SubmissionLimiter();
            for (let i = 0; i < 5; i += 1) {
                limiter.recordSubmission('s:p', 1000 + i * 1000);
            }

            const retryAfter = await limiter.withSlot(
                's:p',
                async (slot) => {
                    expect(slot.isAvailable()).toBe(false);
                    return slot.retryAfterSeconds();
                },
                1000 + 4000,
            );
            // Oldest submission leaves the window at 1000 + 60_000.
            expect(retryAfter).toBe(Math.ceil((1000 + 60_000 - 5000) / 1000));
        });

        it('drops idle locks so the lock maps cannot leak', async () => {
            const limiter = new SubmissionLimiter();
            for (let i = 0; i < 100; i += 1) {
                await limiter.withSlot(`s:p${i}`, async () => undefined, 1000 + i);
            }
            const internals = limiter as unknown as {
                locks: Map<string, Promise<void>>;
                lockHolders: Map<string, number>;
            };
            expect(internals.locks.size).toBe(0);
            expect(internals.lockHolders.size).toBe(0);
        });
    });
});
