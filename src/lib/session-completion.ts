/**
 * Server-side computation of `ListeningSession.completed` (BUSINESS_RULES.md §2.3).
 *
 * The client used to assert this boolean and the server stored it unvalidated.
 * That is not good enough for what the row is used for: MONETIZATION.md treats
 * the ListeningSession ledger as the auditable basis for revenue attribution,
 * and RESEARCH_PROTOCOL.md treats each row as an observation. A number the
 * subject of the measurement supplies is neither auditable nor an observation,
 * so the value is derived here from facts the server already holds.
 */

export type SessionType = 'LIVE' | 'MEDITATION' | 'SCHEDULED_SESSION';

export type ScheduledSessionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

/** A MEDITATION listen counts once it reaches this fraction of the track. */
export const MEDITATION_COMPLETION_FRACTION = 0.85;

/**
 * Floor for content whose total length the server does not know: the live
 * beacon, and — see `computeCompleted` — meditations whose duration was never
 * probed.
 */
export const UNKNOWN_LENGTH_COMPLETION_SECONDS = 60;

export interface CompletionInput {
    type: SessionType;
    /** Elapsed listen time, as computed by the server from startedAt/endedAt. */
    durationSeconds: number;
    /**
     * `Meditation.durationSeconds` for the listened track. 0 means "never
     * probed" (see below); null/undefined means the meditation row is gone —
     * the relation is `onDelete: SetNull`.
     */
    meditationDurationSeconds?: number | null;
    /** Status of the related ScheduledSession, or null if that row is gone. */
    scheduledSessionStatus?: ScheduledSessionStatus | null;
}

/**
 * Decide whether a finished listen counts as completed.
 *
 * - MEDITATION: reached `MEDITATION_COMPLETION_FRACTION` of the track.
 * - SCHEDULED_SESSION: the event ended naturally — status `ENDED`. `CANCELLED`
 *   is the explicit non-natural end; `SCHEDULED`/`LIVE` mean the listener left
 *   before the event finished.
 * - LIVE: the beacon is unbounded, so any listen of at least
 *   `UNKNOWN_LENGTH_COMPLETION_SECONDS` counts.
 *
 * **Unknown totals.** Meditations uploaded before `src/lib/audio-duration.ts`
 * probed on upload stored `durationSeconds = 0`, and `scripts/backfill-durations.mjs`
 * has not been run, so rows with 0 still exist. A fraction of an unknown total
 * is not computable, and neither constant answer is acceptable: hardcoding
 * `false` would record every listen of that back catalogue as incomplete, which
 * under-attributes revenue to the Provider and feeds the research set a false
 * negative for what may have been a full listen; hardcoding `true` would credit
 * a five-second bounce as a completion, which is worse still because it is
 * unfalsifiable — a `false` at least invites the question.
 *
 * So an unknown total falls back to the rule this document already specifies for
 * content of unknown length: the 60-second floor used for LIVE. It is a weaker
 * claim than the 0.85 rule but a true one — the listen really did pass a
 * meaningful threshold — and it degrades in the same direction for both error
 * modes rather than being systematically wrong in one. The same fallback covers
 * a MEDITATION or SCHEDULED_SESSION whose related row has been deleted, where
 * the total is likewise unrecoverable.
 *
 * This means `completed` is not reproducible from the ledger alone for affected
 * rows: which rule ran depends on whether the meditation's duration was known
 * at the time. Running the backfill removes the ambiguity for everything
 * uploaded before the probe landed, and it should be run before these rows are
 * used for attribution or analysis.
 */
export function computeCompleted(input: CompletionInput): boolean {
    const { type, durationSeconds, meditationDurationSeconds, scheduledSessionStatus } = input;

    if (type === 'MEDITATION') {
        if (!meditationDurationSeconds || meditationDurationSeconds <= 0) {
            return durationSeconds >= UNKNOWN_LENGTH_COMPLETION_SECONDS;
        }
        return durationSeconds >= MEDITATION_COMPLETION_FRACTION * meditationDurationSeconds;
    }

    if (type === 'SCHEDULED_SESSION') {
        if (!scheduledSessionStatus) {
            return durationSeconds >= UNKNOWN_LENGTH_COMPLETION_SECONDS;
        }
        return scheduledSessionStatus === 'ENDED';
    }

    return durationSeconds >= UNKNOWN_LENGTH_COMPLETION_SECONDS;
}
