'use client';

/**
 * Operational tapestry (TAP-02 review, issue #129): the staff-only view of
 * the tapestry with hands, names, presence and camera state.
 *
 * O(1) visual transport: ONE shared composite image per poll — the same
 * JPEG the service already builds — plus ONE bounded manifest JSON. Names,
 * hand badges and state markers are semantic overlays on that image, never
 * per-tile <img> requests: 150 participants cost exactly the same as one.
 * When the composite is unavailable the accessible list below still carries
 * every state, without fetching any per-participant image.
 *
 * Freshness vs revision: the composite bytes refresh every accepted cycle
 * (new object URL, previous revoked). The manifest's semantic revision only
 * decides whether annotations re-render, and the layout revision only
 * correlates overlays with the exact composite build they describe — an
 * overlay draws solely when manifest.layout.revision matches the image's
 * x-tapestry-revision, so a name can never land on the wrong person.
 *
 * Polling discipline: each new cycle aborts the previous one and carries a
 * generation counter, so a slow earlier response can never overwrite a
 * newer accepted state; unmounting aborts in-flight work and revokes URLs.
 */

import { useEffect, useRef, useState } from 'react';
import type { Messages } from '@/lib/i18n';
import type {
    TapestryManifest,
    TapestryManifestEntry,
} from '@/lib/tapestry-manifest';

type Copy = Messages['ops']['opsTapestry'];

type Props = {
    sessionId: string;
    copy: Copy;
    /**
     * Polling runs only while the view is actually shown (the cockpit mounts
     * the drawer hidden): a hidden tapestry spends zero requests.
     */
    active?: boolean;
};

const POLL_MS = 3_000;
/**
 * Bounded correlation attempts per cycle (TAP-02 re-review): composite and
 * manifest are one correlated unit — a frame can land between the two reads,
 * so a mismatched pair is retried immediately, never more than this many
 * times per cycle, and never proportionally to the participant count.
 */
const MAX_CORRELATION_ATTEMPTS = 3;

/**
 * One accepted cycle's state: image, build revision and manifest are only
 * ever published together, as a single correlated unit. The overlay check at
 * render (`layout.revision === buildRevision`) suppresses annotations on any
 * fallback pair whose revisions disagree.
 */
type TapestryView = {
    compositeUrl: string | null;
    buildRevision: string | null;
    manifest: TapestryManifest;
};

function stateLabel(entry: TapestryManifestEntry, copy: Copy): string {
    const parts = [
        entry.displayName,
        entry.handRaised && entry.queuePosition !== null
            ? copy.handRaised.replace('{position}', String(entry.queuePosition))
            : null,
        copy.presence[entry.presence],
        copy.camera[entry.camera],
    ];
    return parts.filter(Boolean).join(' — ');
}

export default function OpsTapestry({ sessionId, copy, active = true }: Props) {
    const [view, setView] = useState<TapestryView | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    // Content key = semantic revision + layout revision: a layout advance is
    // stored even when names, order, hands, camera and presence are identical.
    const lastContentKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!active) return;
        let live = true;
        let generation = 0;
        let controller: AbortController | null = null;
        // The ONE object URL the visible state currently owns. Any URL not
        // transferred here is revoked by the cycle that created it.
        let publishedUrl: string | null = null;

        // Session-scoped reset: never carry manifest, names, overlays, the
        // content cache or error state across a sessionId change. The next
        // session starts from empty — if its first fetch fails, the UI shows
        // ITS empty/error state, never the previous session's data.
        lastContentKeyRef.current = null;
        setView(null);
        setUnavailable(false);

        const manifestUrl = `/api/ops/sessions/${encodeURIComponent(sessionId)}/tapestry/manifest`;
        // The consumer marker lets observability and tests tell this poll
        // apart from other composite consumers (health panel, room surface);
        // the route ignores unknown query params.
        const compositeUrl = `/api/tapestry/${encodeURIComponent(sessionId)}?view=ops-tapestry`;

        const cycle = async () => {
            if (!live) return;
            // A newer cycle supersedes any slower one still in flight.
            const myGeneration = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;

            // Every object URL created this cycle is registered here.
            // Exactly one may be chosen and transferred to the visible state;
            // all others are revoked exactly once before the cycle returns.
            const candidates: Array<{ url: string; revision: string | null; manifest: TapestryManifest }> = [];
            let chosen: (typeof candidates)[number] | null = null;

            for (let attempt = 0; attempt < MAX_CORRELATION_ATTEMPTS; attempt += 1) {
                if (!live || myGeneration !== generation) break;
                let url: string | null = null;
                try {
                    // 1. Composite first, 2. manifest immediately after: the
                    // pair is accepted only when both describe the same build.
                    const compositeRes = await fetch(compositeUrl, {
                        cache: 'no-store', credentials: 'same-origin', signal,
                    });
                    if (!compositeRes.ok) break; // keep previous image; semantic refresh below
                    const revision = compositeRes.headers.get('x-tapestry-revision');
                    const blob = await compositeRes.blob();
                    if (!live || myGeneration !== generation) {
                        // Superseded or unmounted mid-read: stop before
                        // spending the manifest fetch or creating any blob.
                        return;
                    }
                    url = URL.createObjectURL(blob);

                    const manifestRes = await fetch(manifestUrl, {
                        cache: 'no-store', credentials: 'same-origin', signal,
                    });
                    if (!manifestRes.ok) {
                        URL.revokeObjectURL(url); // never became a candidate
                        for (const c of candidates) URL.revokeObjectURL(c.url);
                        if (live && myGeneration === generation) setUnavailable(true);
                        return;
                    }
                    const manifest = await manifestRes.json() as TapestryManifest;
                    candidates.push({ url, revision, manifest });
                    url = null; // ownership moved into the candidates registry
                    const layoutRevision = manifest.layout?.revision ?? null;
                    // 3-4. Matching revisions (or no grid to correlate)
                    // publish as one accepted state; a mismatch retries.
                    if (layoutRevision === null || String(layoutRevision) === revision) {
                        chosen = candidates[candidates.length - 1];
                        break;
                    }
                } catch {
                    // Aborted by a newer cycle or unmount, or a transient
                    // failure. Stop attempting: the freshest candidate (if
                    // any) still serves as the safe fallback below.
                    if (url) URL.revokeObjectURL(url); // never became a candidate
                    break;
                }
            }

            // Safe fallback: the freshest candidate; the render-time
            // revision check keeps its overlays hidden while mismatched.
            if (!chosen && candidates.length > 0) chosen = candidates[candidates.length - 1];
            // Revoke every non-chosen candidate exactly once.
            for (const c of candidates) {
                if (c !== chosen) URL.revokeObjectURL(c.url);
            }

            let manifestOnly: TapestryManifest | null = null;
            if (!chosen) {
                // Composite unavailable from the start of the cycle: keep the
                // previous image and still refresh the semantic list.
                try {
                    const manifestRes = await fetch(manifestUrl, {
                        cache: 'no-store', credentials: 'same-origin', signal,
                    });
                    if (!manifestRes.ok) {
                        if (live && myGeneration === generation) setUnavailable(true);
                        return;
                    }
                    manifestOnly = await manifestRes.json() as TapestryManifest;
                } catch {
                    return;
                }
            }
            // A stale generation discards its chosen URL before dying.
            if (!live || myGeneration !== generation) {
                if (chosen) URL.revokeObjectURL(chosen.url);
                return;
            }

            const manifest = chosen?.manifest ?? manifestOnly;
            if (!manifest) return;
            setUnavailable(false);
            // Session + semantic + layout key: content never crosses
            // sessions, and a layout advance is stored even when names,
            // order, hands, camera and presence are identical.
            const contentKey = `${sessionId}:${manifest.revision}:${manifest.layout?.revision ?? 'none'}`;
            const manifestChanged = contentKey !== lastContentKeyRef.current;
            if (manifestChanged) lastContentKeyRef.current = contentKey;
            setView((prev) => ({
                compositeUrl: chosen ? chosen.url : prev?.compositeUrl ?? null,
                buildRevision: chosen ? chosen.revision : prev?.buildRevision ?? null,
                manifest: manifestChanged || !prev ? manifest : prev.manifest,
            }));
            // Ownership transfer, outside the state updater: the chosen URL
            // now belongs to the visible state; the retired one is revoked
            // exactly once, here or at cleanup.
            if (chosen) {
                const retired = publishedUrl;
                publishedUrl = chosen.url;
                if (retired && retired !== chosen.url) URL.revokeObjectURL(retired);
            }
        };

        void cycle();
        const timer = setInterval(() => void cycle(), POLL_MS);
        return () => {
            live = false;
            clearInterval(timer);
            controller?.abort();
            if (publishedUrl) {
                URL.revokeObjectURL(publishedUrl);
                publishedUrl = null;
            }
        };
    }, [sessionId, active]);

    if (!view && !unavailable) {
        return <p className="text-sm text-[var(--text-muted)]">{copy.loading}</p>;
    }
    if (unavailable) {
        return <p className="text-sm text-[var(--text-muted)]">{copy.unavailable}</p>;
    }
    if (!view) {
        return null;
    }

    const { manifest, compositeUrl: compositeSrc, buildRevision } = view;
    const handCount = manifest.waitingHands.length;
    // Annotations draw only on a correlated pair: a fallback whose layout
    // revision disagrees with the image renders the list, never an overlay.
    const overlayLayout = manifest.layout !== null &&
        buildRevision !== null &&
        String(manifest.layout.revision) === buildRevision
        ? manifest.layout
        : null;
    const tilelessHands = manifest.waitingHands.filter((hand) => hand.tileId === null);

    return (
        <section aria-label={copy.heading} className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--cream)]">{copy.heading}</h3>
            <span className="sr-only" aria-live="polite">
                {handCount === 1
                    ? copy.handSummaryOne
                    : copy.handsSummaryMany.replace('{count}', String(handCount))}
            </span>

            {compositeSrc ? (
                <div className="relative inline-block max-w-full">
                    {/* The single image every visual state rides on. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={compositeSrc}
                        alt={copy.compositeAlt}
                        className="block max-w-full rounded-lg border border-[var(--border-subtle)]"
                    />
                    {overlayLayout ? (
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                            {manifest.entries.map((entry) => (
                                <CellOverlay key={entry.tileId} entry={entry} layout={overlayLayout} copy={copy} />
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {manifest.entries.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{copy.empty}</p>
            ) : null}

            {tilelessHands.length > 0 ? (
                <p className="text-xs text-[var(--gold)]">
                    {copy.waitingWithoutTile.replace(
                        '{names}',
                        tilelessHands.map((hand) => `${hand.displayName} (#${hand.queuePosition})`).join(', '),
                    )}
                </p>
            ) : null}

            {/* The accessible state surface: every overlay fact as plain text.
                Nothing hides behind hover, so mouse, touch, keyboard and
                screen readers all get the same complete state. */}
            {manifest.entries.length > 0 ? (
                <ul className="space-y-1" aria-label={copy.heading}>
                    {manifest.entries.map((entry) => (
                        <li key={entry.tileId} className="text-xs text-[var(--text-muted)]">
                            <span className="text-[var(--cream)]">{entry.displayName}</span>
                            {entry.handRaised && entry.queuePosition !== null ? (
                                <span className="ml-2 rounded bg-[var(--pink)] px-1.5 py-0.5 font-semibold text-[var(--night)]">
                                    {copy.handRaised.replace('{position}', String(entry.queuePosition))}
                                </span>
                            ) : null}
                            <span className="ml-2">{copy.presence[entry.presence]}</span>
                            <span className="ml-2">{copy.camera[entry.camera]}</span>
                            <span className="sr-only">{stateLabel(entry, copy)}</span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {manifest.tileFreshForSeconds !== null ? (
                <p className="text-xs text-[var(--text-muted)]">
                    {copy.freshnessNote.replace('{seconds}', String(manifest.tileFreshForSeconds))}
                </p>
            ) : null}
            {!manifest.liveStateAvailable ? (
                <p className="text-xs text-[var(--gold)]">{copy.liveStateUnknown}</p>
            ) : null}
        </section>
    );
}

function CellOverlay({
    entry,
    layout,
    copy,
}: {
    entry: TapestryManifestEntry;
    layout: { columns: number; rows: number };
    copy: Copy;
}) {
    const left = `${(entry.column / layout.columns) * 100}%`;
    const top = `${(entry.row / layout.rows) * 100}%`;
    const width = `${100 / layout.columns}%`;
    const height = `${100 / layout.rows}%`;
    const dimmed = entry.presence === 'left' || entry.presence === 'reconnecting';
    return (
        <span className="absolute" style={{ left, top, width, height }}>
            {dimmed ? <span className="absolute inset-0 bg-black/55" /> : null}
            {entry.handRaised && entry.queuePosition !== null ? (
                <span className="absolute left-0.5 top-0.5 rounded bg-[var(--pink)] px-1 py-0.5 text-xs font-semibold leading-4 text-[var(--night)]">
                    {copy.handRaised.replace('{position}', String(entry.queuePosition))}
                </span>
            ) : null}
            {entry.camera === 'off' ? (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-[var(--cream)] bg-transparent" />
            ) : null}
            <span
                className="absolute bottom-0 left-0 max-w-full rounded-tr bg-black/70 px-1 py-0.5 text-xs leading-4 text-[var(--cream)]"
                style={{ overflowWrap: 'anywhere' }}
            >
                {entry.displayName}
            </span>
        </span>
    );
}
