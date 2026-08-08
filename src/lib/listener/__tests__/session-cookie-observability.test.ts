import { describe, expect, it } from 'vitest';

import {
    LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC,
    LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC,
    LISTENER_SESSION_COOKIE_STATES,
    recordListenerSessionCookieObservation,
    renderListenerSessionCookieObservations,
    snapshotListenerSessionCookieObservations,
} from '@/lib/listener/session-cookie-observability';

const REGISTRY_DESCRIPTION = 'harmonic-beacon.listener.session-cookie-observations';

type Registry = {
    startedAtSeconds: number;
    counts: Record<string, number>;
};

// Vitest evaluates the module in a separate realm whose `Symbol.for` registry
// is realm-local, so the test reaches the shared globalThis slot by symbol
// description instead of by `Symbol.for` identity.
function internalRegistry(): Registry {
    const symbol = Object.getOwnPropertySymbols(globalThis)
        .find((candidate) => candidate.description === REGISTRY_DESCRIPTION);
    expect(symbol, 'registry symbol on globalThis').toBeDefined();
    return (globalThis as Record<symbol, Registry>)[symbol as symbol];
}

describe('Listener session-cookie observability registry', () => {
    it('exposes exactly the closed nine-state allowlist', () => {
        expect(LISTENER_SESSION_COOKIE_STATES).toEqual([
            'none',
            'legacy_only',
            'dual_identical',
            'canonical_only',
            'conflicting_pair',
            'duplicate_name',
            'malformed_value',
            'oversized_value',
            'oversized_header',
        ]);
    });

    it('counts every allowlisted state and keeps a stable series order', () => {
        const before = snapshotListenerSessionCookieObservations();
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            recordListenerSessionCookieObservation(state);
        }
        recordListenerSessionCookieObservation('dual_identical');
        const after = snapshotListenerSessionCookieObservations();

        expect(Object.keys(after.counts)).toEqual([...LISTENER_SESSION_COOKIE_STATES]);
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            expect(after.counts[state]).toBe(before.counts[state] + (state === 'dual_identical' ? 2 : 1));
        }
    });

    it('exposes all nine series including zero values in snapshots and render', () => {
        const snapshot = snapshotListenerSessionCookieObservations();
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            expect(snapshot.counts[state]).toBeGreaterThanOrEqual(0);
        }
        const render = renderListenerSessionCookieObservations();
        for (const state of LISTENER_SESSION_COOKIE_STATES) {
            expect(render).toMatch(
                new RegExp(`^${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}\\{state="${state}"\\} \\d+$`, 'm'),
            );
        }
    });

    it('discards unknown states without throwing', () => {
        const before = snapshotListenerSessionCookieObservations();
        expect(() => {
            recordListenerSessionCookieObservation('unknown_state');
            recordListenerSessionCookieObservation('');
            recordListenerSessionCookieObservation('state","x="1');
            recordListenerSessionCookieObservation(undefined as unknown as string);
        }).not.toThrow();
        expect(snapshotListenerSessionCookieObservations().counts).toEqual(before.counts);
    });

    it('keeps snapshot and render nonthrowing if the process-local registry is corrupted', () => {
        const holder = internalRegistry() as unknown as { counts: unknown };
        const saved = holder.counts;
        try {
            holder.counts = null;
            expect(() => snapshotListenerSessionCookieObservations()).not.toThrow();
            expect(snapshotListenerSessionCookieObservations().counts)
                .toEqual(Object.fromEntries(LISTENER_SESSION_COOKIE_STATES.map((state) => [state, 0])));
            expect(() => renderListenerSessionCookieObservations()).not.toThrow();
            expect(renderListenerSessionCookieObservations())
                .toContain(`${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}{state="none"} 0`);
        } finally {
            holder.counts = saved;
        }
    });

    it('is monotonic and saturates at Number.MAX_SAFE_INTEGER', () => {
        const counts = internalRegistry().counts;
        const saved = counts.legacy_only;
        try {
            recordListenerSessionCookieObservation('legacy_only');
            expect(counts.legacy_only).toBe(saved + 1);

            counts.legacy_only = Number.MAX_SAFE_INTEGER - 1;
            recordListenerSessionCookieObservation('legacy_only');
            expect(counts.legacy_only).toBe(Number.MAX_SAFE_INTEGER);
            recordListenerSessionCookieObservation('legacy_only');
            expect(counts.legacy_only).toBe(Number.MAX_SAFE_INTEGER);
        } finally {
            counts.legacy_only = saved + 1;
        }
    });

    it('keeps one registry and a stable process start epoch across the process', () => {
        const first = snapshotListenerSessionCookieObservations();
        const second = snapshotListenerSessionCookieObservations();
        expect(second.startedAtSeconds).toBe(first.startedAtSeconds);
        expect(Number.isInteger(first.startedAtSeconds)).toBe(true);
        expect(first.startedAtSeconds).toBeGreaterThan(0);
        expect(internalRegistry().startedAtSeconds).toBe(first.startedAtSeconds);
    });

    it('renders valid text exposition with only the fixed state label and gauge', () => {
        const render = renderListenerSessionCookieObservations();
        expect(render.endsWith('\n')).toBe(true);
        const lines = render.trimEnd().split('\n');
        expect(lines[0]).toBe(`# HELP ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} Listener session-cookie compatibility states observed by session resolver invocations (aggregate per process; not unique users, browsers or sessions).`);
        expect(lines[1]).toBe(`# TYPE ${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC} counter`);
        for (const [index, state] of LISTENER_SESSION_COOKIE_STATES.entries()) {
            expect(lines[2 + index]).toMatch(
                new RegExp(`^${LISTENER_SESSION_COOKIE_OBSERVATIONS_METRIC}\\{state="${state}"\\} \\d+$`),
            );
        }
        const tail = lines.slice(2 + LISTENER_SESSION_COOKIE_STATES.length);
        expect(tail).toEqual([
            `# HELP ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} Unix epoch seconds when this observer process created its session-cookie observation registry.`,
            `# TYPE ${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} gauge`,
            `${LISTENER_SESSION_COOKIE_OBSERVER_START_METRIC} ${snapshotListenerSessionCookieObservations().startedAtSeconds}`,
        ]);
    });

    it('renders no cookie, header, user, session, account, IP or UA material', () => {
        const render = renderListenerSessionCookieObservations();
        // Every label set is exactly one fixed `state` label over the allowlist.
        const labelSets = [...render.matchAll(/\{([^}]*)\}/g)].map((match) => match[1]);
        expect(labelSets).toHaveLength(LISTENER_SESSION_COOKIE_STATES.length);
        for (const labelSet of labelSets) {
            expect(labelSet).toMatch(/^state="(none|legacy_only|dual_identical|canonical_only|conflicting_pair|duplicate_name|malformed_value|oversized_value|oversized_header)"$/);
        }
        // No request-shaped material can appear: values are only integers.
        for (const line of render.trimEnd().split('\n')) {
            expect(line).toMatch(/^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+(\{state="[a-z_]+"\})? \d+)$/);
        }
    });
});
