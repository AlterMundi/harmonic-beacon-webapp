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
    const [manifest, setManifest] = useState<TapestryManifest | null>(null);
    const [compositeSrc, setCompositeSrc] = useState<string | null>(null);
    const [compositeRevision, setCompositeRevision] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const lastRevisionRef = useRef<string | null>(null);

    useEffect(() => {
        if (!active) return;
        let live = true;
        let generation = 0;
        let controller: AbortController | null = null;
        let previousUrl: string | null = null;
        const manifestUrl = `/api/ops/sessions/${encodeURIComponent(sessionId)}/tapestry/manifest`;
        const compositeUrl = `/api/tapestry/${encodeURIComponent(sessionId)}`;

        const cycle = async () => {
            if (!live) return;
            // A newer cycle supersedes any slower one still in flight.
            const myGeneration = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;
            let freshUrl: string | null = null;
            try {
                const manifestRes = await fetch(manifestUrl, {
                    cache: 'no-store', credentials: 'same-origin', signal,
                });
                if (!manifestRes.ok) {
                    if (live && myGeneration === generation) setUnavailable(true);
                    return;
                }
                const next = await manifestRes.json() as TapestryManifest;
                if (!live || myGeneration !== generation) {
                    // Unmounted or superseded while parsing: stop before
                    // spending the composite fetch.
                    return;
                }

                // The composite is the only image fetched, once per cycle,
                // and its bytes update even when nothing semantic changed.
                let freshRevision: string | null = null;
                const compositeRes = await fetch(compositeUrl, {
                    cache: 'no-store', credentials: 'same-origin', signal,
                });
                if (compositeRes.ok) {
                    freshRevision = compositeRes.headers.get('x-tapestry-revision');
                    freshUrl = URL.createObjectURL(await compositeRes.blob());
                }

                if (!live || myGeneration !== generation) {
                    // A stale cycle must not touch state or leak its blob.
                    if (freshUrl) URL.revokeObjectURL(freshUrl);
                    return;
                }
                if (next.revision !== lastRevisionRef.current) {
                    lastRevisionRef.current = next.revision;
                    setManifest(next);
                }
                setUnavailable(false);
                if (freshUrl) {
                    setCompositeSrc(freshUrl);
                    setCompositeRevision(freshRevision);
                    if (previousUrl) URL.revokeObjectURL(previousUrl);
                    previousUrl = freshUrl;
                }
            } catch {
                // Aborted by a newer cycle or unmount, or a transient
                // network failure: the next tick retries.
            }
        };

        void cycle();
        const timer = setInterval(() => void cycle(), POLL_MS);
        return () => {
            live = false;
            clearInterval(timer);
            controller?.abort();
            if (previousUrl) URL.revokeObjectURL(previousUrl);
        };
    }, [sessionId, active]);

    if (!manifest && !unavailable) {
        return <p className="text-sm text-[var(--text-muted)]">{copy.loading}</p>;
    }
    if (unavailable) {
        return <p className="text-sm text-[var(--text-muted)]">{copy.unavailable}</p>;
    }
    if (!manifest) {
        return null;
    }

    const handCount = manifest.waitingHands.length;
    const overlayLayout = manifest.layout !== null &&
        compositeRevision !== null &&
        String(manifest.layout.revision) === compositeRevision
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
