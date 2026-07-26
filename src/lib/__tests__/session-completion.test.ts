import { describe, it, expect } from 'vitest';
import {
    computeCompleted,
    MEDITATION_COMPLETION_FRACTION,
    UNKNOWN_LENGTH_COMPLETION_SECONDS,
} from '../session-completion';

describe('computeCompleted - MEDITATION', () => {
    it('completes at exactly 0.85 of the track', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 510,
                meditationDurationSeconds: 600,
            }),
        ).toBe(true);
    });

    it('does not complete just below 0.85', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 509,
                meditationDurationSeconds: 600,
            }),
        ).toBe(false);
    });

    it('completes when the listen runs past the end of the track', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 700,
                meditationDurationSeconds: 600,
            }),
        ).toBe(true);
    });

    it('does not complete on a short bounce', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 5,
                meditationDurationSeconds: 600,
            }),
        ).toBe(false);
    });

    it('uses the fraction constant rather than a hardcoded threshold', () => {
        const total = 1000;
        const threshold = MEDITATION_COMPLETION_FRACTION * total;
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: threshold,
                meditationDurationSeconds: total,
            }),
        ).toBe(true);
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: threshold - 1,
                meditationDurationSeconds: total,
            }),
        ).toBe(false);
    });
});

describe('computeCompleted - MEDITATION with unknown duration', () => {
    // Pre-backfill rows store durationSeconds = 0. The fraction is uncomputable,
    // so the rule falls back to the 60s floor used for content of unknown length.
    it('falls back to the 60s floor when the meditation duration is 0', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: UNKNOWN_LENGTH_COMPLETION_SECONDS,
                meditationDurationSeconds: 0,
            }),
        ).toBe(true);
    });

    it('does not complete a sub-60s listen of a 0-duration meditation', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 59,
                meditationDurationSeconds: 0,
            }),
        ).toBe(false);
    });

    it('does not report false for every long listen of a 0-duration meditation', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 1200,
                meditationDurationSeconds: 0,
            }),
        ).toBe(true);
    });

    it('applies the same fallback when the meditation row is gone (null)', () => {
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 300,
                meditationDurationSeconds: null,
            }),
        ).toBe(true);
        expect(
            computeCompleted({
                type: 'MEDITATION',
                durationSeconds: 10,
                meditationDurationSeconds: null,
            }),
        ).toBe(false);
    });

    it('applies the same fallback when the field is absent', () => {
        expect(
            computeCompleted({ type: 'MEDITATION', durationSeconds: 90 }),
        ).toBe(true);
    });
});

describe('computeCompleted - SCHEDULED_SESSION', () => {
    it('completes when the event ended naturally', () => {
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 30,
                scheduledSessionStatus: 'ENDED',
            }),
        ).toBe(true);
    });

    it('does not complete a cancelled event, however long the listen', () => {
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 3600,
                scheduledSessionStatus: 'CANCELLED',
            }),
        ).toBe(false);
    });

    it('does not complete while the event is still live', () => {
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 3600,
                scheduledSessionStatus: 'LIVE',
            }),
        ).toBe(false);
    });

    it('does not complete when the event never started', () => {
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 120,
                scheduledSessionStatus: 'SCHEDULED',
            }),
        ).toBe(false);
    });

    it('falls back to the 60s floor when the session row is gone', () => {
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 120,
                scheduledSessionStatus: null,
            }),
        ).toBe(true);
        expect(
            computeCompleted({
                type: 'SCHEDULED_SESSION',
                durationSeconds: 20,
                scheduledSessionStatus: null,
            }),
        ).toBe(false);
    });
});

describe('computeCompleted - LIVE', () => {
    it('completes at exactly 60 seconds', () => {
        expect(computeCompleted({ type: 'LIVE', durationSeconds: 60 })).toBe(true);
    });

    it('does not complete at 59 seconds', () => {
        expect(computeCompleted({ type: 'LIVE', durationSeconds: 59 })).toBe(false);
    });

    it('ignores meditation duration for a LIVE listen', () => {
        expect(
            computeCompleted({
                type: 'LIVE',
                durationSeconds: 120,
                meditationDurationSeconds: 100000,
            }),
        ).toBe(true);
    });

    it('does not complete a zero-length listen', () => {
        expect(computeCompleted({ type: 'LIVE', durationSeconds: 0 })).toBe(false);
    });
});
