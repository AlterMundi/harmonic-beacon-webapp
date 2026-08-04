'use client';

/**
 * Operational tapestry (TAP-02, issue #129): the staff-only view of the
 * tapestry with hands, names, presence and camera state per tile.
 *
 * One manifest request per poll — never a request per tile. Thumbnails are
 * the epoch-versioned proxy URLs the manifest carries, so the browser cache
 * deduplicates frames inside the refresh window. A missing or expired frame
 * falls back to a quiet deterministic color field with the person's name;
 * the fallback never says *why* the image is gone (consent, TTL, departure
 * and failure are intentionally indistinguishable).
 *
 * Every affordance has a hover, touch, keyboard and screen-reader
 * equivalent: tiles are buttons whose full state is always in the
 * accessible name, and activating one (pointer, Enter, Space) toggles a
 * textual detail line. The hand indicator is a labelled badge, never color
 * alone. Hand-count changes are announced once in a polite live region;
 * routine refreshes are silent.
 */

import { useEffect, useRef, useState } from 'react';
import type { Messages } from '@/lib/i18n';
import type {
    TapestryManifest,
    TapestryManifestEntry,
} from '@/lib/tapestry-manifest';

const POLL_INTERVAL_MS = 3_000;

/** Four quiet fields, chosen deterministically by opaque tile id. */
const FALLBACK_FIELDS = [
    'bg-[var(--forest)]',
    'bg-[var(--night)]',
    'bg-[var(--border-subtle)]',
    'bg-black/40',
] as const;

function fallbackField(tileId: string): string {
    let hash = 0;
    for (let index = 0; index < tileId.length; index += 1) {
        hash = (hash * 31 + tileId.charCodeAt(index)) >>> 0;
    }
    return FALLBACK_FIELDS[hash % FALLBACK_FIELDS.length];
}

type Copy = Messages['ops']['opsTapestry'];

type Props = {
    sessionId: string;
    copy: Copy;
};

function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.replace(`{${key}}`, String(value)),
        template,
    );
}

function tileAccessibleName(entry: TapestryManifestEntry, copy: Copy): string {
    const parts = [entry.displayName];
    if (entry.handRaised && entry.queuePosition !== null) {
        parts.push(fill(copy.handRaised, { position: entry.queuePosition }));
    }
    parts.push(copy.presence[entry.presence]);
    parts.push(copy.camera[entry.camera]);
    return parts.join(', ');
}

function Tile({ entry, copy }: { entry: TapestryManifestEntry; copy: Copy }) {
    const [expanded, setExpanded] = useState(false);
    // Track the exact URL that failed: the next epoch's URL gets a fresh
    // chance, so a transient proxy error cannot wedge the fallback on.
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const detailId = `ops-tapestry-detail-${entry.position}`;
    const showImage = entry.thumbnailUrl !== null && entry.thumbnailUrl !== failedUrl;
    const accessibleName = tileAccessibleName(entry, copy);

    return (
        <li className="flex w-28 flex-col items-center gap-1">
            <button
                type="button"
                aria-label={accessibleName}
                aria-expanded={expanded}
                aria-controls={detailId}
                title={accessibleName}
                onClick={() => setExpanded((current) => !current)}
                className="relative block h-20 w-28 overflow-hidden rounded border border-[var(--border-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
            >
                {showImage ? (
                    // Tiles are already sized by the staff proxy; render the
                    // bounded frame without stretching.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={entry.thumbnailUrl ?? undefined}
                        alt={fill(copy.tileSnapshotAlt, { name: entry.displayName })}
                        onError={() => setFailedUrl(entry.thumbnailUrl)}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <span
                        role="img"
                        aria-label={fill(copy.tileNoSnapshotAlt, { name: entry.displayName })}
                        className={`block h-full w-full ${fallbackField(entry.tileId)}`}
                    />
                )}
                {entry.handRaised && entry.queuePosition !== null ? (
                    <span className="absolute left-1 top-1 rounded bg-[var(--pink)] px-1.5 py-0.5 text-xs font-semibold leading-4 text-[var(--night)]">
                        {fill(copy.handRaised, { position: entry.queuePosition })}
                    </span>
                ) : null}
            </button>
            <span className="w-full break-words text-center text-xs leading-4 text-[var(--cream)]" title={entry.displayName}>
                {entry.displayName}
            </span>
            <span
                id={detailId}
                hidden={!expanded}
                className="w-full text-center text-xs leading-4 text-[var(--text-muted)]"
            >
                {copy.presence[entry.presence]} · {copy.camera[entry.camera]}
            </span>
        </li>
    );
}

export default function OpsTapestry({ sessionId, copy }: Props) {
    const [manifest, setManifest] = useState<TapestryManifest | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const lastRevisionRef = useRef<string | null>(null);

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            try {
                const response = await fetch(
                    `/api/ops/sessions/${encodeURIComponent(sessionId)}/tapestry/manifest`,
                    { cache: 'no-store', credentials: 'same-origin' },
                );
                if (!response.ok) {
                    if (active) setUnavailable(true);
                    return;
                }
                const next = await response.json() as TapestryManifest;
                if (!active) return;
                // Ignore stale renders: only repaint when the content revision
                // actually moved, so a slow poll never reshuffles settled tiles.
                if (next.revision !== lastRevisionRef.current) {
                    lastRevisionRef.current = next.revision;
                    setManifest(next);
                }
                setUnavailable(false);
            } catch {
                if (active) setUnavailable(true);
            }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
        return () => { active = false; clearInterval(timer); };
    }, [sessionId]);

    const handCount = manifest?.waitingHands.length ?? 0;
    const handsSummary = handCount === 1
        ? copy.handSummaryOne
        : fill(copy.handsSummaryMany, { count: handCount });
    const handsWithoutTile = (manifest?.waitingHands ?? [])
        .filter((hand) => hand.tileId === null)
        .map((hand) => hand.displayName);

    return (
        <section
            className="rounded-lg border border-[var(--border-subtle)] p-4"
            aria-label={copy.heading}
        >
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {copy.heading}
                </h2>
                <span aria-live="polite" className="text-xs text-[var(--pink)]">
                    {handCount > 0 ? handsSummary : ''}
                </span>
            </div>
            {unavailable ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.unavailable}</p>
            ) : manifest === null ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.loading}</p>
            ) : (
                <>
                    {manifest.liveStateAvailable ? null : (
                        <p className="mb-2 text-xs text-[var(--warning)]">
                            {copy.liveStateUnknown}
                        </p>
                    )}
                    {manifest.entries.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">{copy.empty}</p>
                    ) : (
                        <ul className="flex flex-wrap gap-3">
                            {manifest.entries.map((entry) => (
                                <Tile key={entry.tileId} entry={entry} copy={copy} />
                            ))}
                        </ul>
                    )}
                    {handsWithoutTile.length > 0 ? (
                        <p className="mt-3 text-xs text-[var(--text-muted)]">
                            {fill(copy.waitingWithoutTile, { names: handsWithoutTile.join(', ') })}
                        </p>
                    ) : null}
                    <p className="mt-3 text-xs text-[var(--text-muted)]">
                        {fill(copy.freshnessNote, { seconds: manifest.thumbnailFreshForSeconds })}
                    </p>
                </>
            )}
        </section>
    );
}
