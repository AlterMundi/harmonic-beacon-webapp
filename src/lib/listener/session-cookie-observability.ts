/**
 * Listener session-cookie compatibility observability.
 *
 * A process-local, in-memory registry that counts how often the Listener
 * session resolvers (the auth-handler bridge and `currentEarlyBirdSession`)
 * observe each inbound session-cookie compatibility state. It exists to size
 * the rollback-compatible dual-cookie support window; it is deliberately
 * aggregate-only:
 *
 * - exactly one fixed label, `state`, over a closed allowlist of nine states;
 *   no external labels are ever accepted, and
 * - no cookie, header, user, session, account, IP or user-agent value is ever
 *   stored or rendered.
 *
 * Counters measure resolver INVOCATIONS, not unique users, browsers or
 * sessions: one navigation can invoke a resolver several times, and one
 * session is observed on every request. The registry is per process/replica
 * and resets on restart; the unlabeled process-start gauge separates epochs,
 * and snapshots must be archived externally per epoch to establish any
 * continuity (a current zero cannot prove seven quiet days).
 *
 * The registry lives on `globalThis` under a `Symbol.for` key so a module
 * reload (development hot reload, test re-import) shares one registry per
 * process instead of resetting it. Recording, snapshots and rendering are
 * bounded, synchronous and nonthrowing: observation must never affect
 * authentication behavior.
 */

export const LISTENER_SESSION_COOKIE_STATES = [
    'none',
    'legacy_only',
    'dual_identical',
    'canonical_only',
    'conflicting_pair',
    'duplicate_name',
    'malformed_value',
    'oversized_value',
    'oversized_header',
] as const;

export type ListenerSessionCookieState = typeof LISTENER_SESSION_COOKIE_STATES[number];

export const LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC =
    'beacon_listener_session_cookie_observations_total';
export const LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC =
    'beacon_listener_session_cookie_observer_process_start_time_seconds';

const REGISTRY_KEY = Symbol.for('harmonic-beacon.listener.session-cookie-observations');
const PROCESS_START_SECONDS = Math.floor(Date.now() / 1000);

type ListenerSessionCookieObservationRegistry = {
    /** Unix epoch seconds when this process first created the registry. */
    readonly startedAtSeconds: number;
    readonly counts: Record<ListenerSessionCookieState, number>;
};

export type ListenerSessionCookieObservationSnapshot = {
    readonly startedAtSeconds: number;
    readonly counts: Record<ListenerSessionCookieState, number>;
};

function emptyCounts(): Record<ListenerSessionCookieState, number> {
    return Object.fromEntries(
        LISTENER_SESSION_COOKIE_STATES.map((state) => [state, 0]),
    ) as Record<ListenerSessionCookieState, number>;
}

function registry(): ListenerSessionCookieObservationRegistry {
    const scope = globalThis as Record<symbol, ListenerSessionCookieObservationRegistry | undefined>;
    let existing = scope[REGISTRY_KEY];
    if (!existing) {
        existing = {
            startedAtSeconds: PROCESS_START_SECONDS,
            counts: emptyCounts(),
        };
        scope[REGISTRY_KEY] = existing;
    }
    return existing;
}

/**
 * Records one resolver observation of an inbound session-cookie state.
 * Unknown states are discarded, increments saturate at
 * `Number.MAX_SAFE_INTEGER`, and any observer failure is swallowed: this call
 * must never change an auth outcome.
 */
export function recordListenerSessionCookieObservation(state: string): void {
    try {
        const counts = registry().counts;
        if (!Object.hasOwn(counts, state)) return;
        const known = state as ListenerSessionCookieState;
        counts[known] = Math.min(counts[known] + 1, Number.MAX_SAFE_INTEGER);
    } catch { /* Observation is best-effort and must never throw. */ }
}

/**
 * A copy of the current registry: all nine series in stable allowlist order
 * (including zero values) plus the stable process-start epoch.
 */
export function snapshotListenerSessionCookieObservations(): ListenerSessionCookieObservationSnapshot {
    try {
        const current = registry();
        const counts = emptyCounts();
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            const value = current.counts[state];
            counts[state] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
        }
        const startedAtSeconds = Number.isSafeInteger(current.startedAtSeconds) &&
            current.startedAtSeconds > 0
            ? current.startedAtSeconds
            : PROCESS_START_SECONDS;
        return { startedAtSeconds, counts };
    } catch {
        return { startedAtSeconds: PROCESS_START_SECONDS, counts: emptyCounts() };
    }
}

/**
 * Prometheus text exposition (0.0.4) of the registry. Every line is fixed
 * except the aggregate numbers; the only label is `state` over the closed
 * allowlist, so no request material can ever reach the output.
 */
export function renderListenerSessionCookieObservations(): string {
    try {
        const snapshot = snapshotListenerSessionCookieObservations();
        const lines = [
            `# HELP ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} Listener session-cookie compatibility states observed by session resolver invocations (aggregate per process; not unique users, browsers or sessions).`,
            `# TYPE ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} counter`,
        ];
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            lines.push(`${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}{state="${state}"} ${snapshot.counts[state]}`);
        }
        lines.push(
            `# HELP ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} Unix epoch seconds when this observer process created its session-cookie observation registry.`,
            `# TYPE ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} gauge`,
            `${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} ${snapshot.startedAtSeconds}`,
            '',
        );
        return lines.join('\n');
    } catch {
        // Even a corrupted process-local registry must not affect auth. The
        // fixed empty exposition remains privacy-safe and identifies this
        // process epoch; operators must treat the missing prior counts as a
        // continuity gap rather than evidence of zero legacy use.
        const lines = LISTENER_SESSION_COOKIE_STATES.map(
            (state) => `${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}{state="${state}"} 0`,
        );
        return [
            `# HELP ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} Listener session-cookie compatibility states observed by session resolver invocations (aggregate per process; not unique users, browsers or sessions).`,
            `# TYPE ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} counter`,
            ...lines,
            `# HELP ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} Unix epoch seconds when this observer process created its session-cookie observation registry.`,
            `# TYPE ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} gauge`,
            `${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} ${PROCESS_START_SECONDS}`,
            '',
        ].join('\n');
    }
}
