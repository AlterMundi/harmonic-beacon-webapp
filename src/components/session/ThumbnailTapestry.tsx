'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import type { Messages } from '@/lib/i18n';

type Props = {
    sessionId: string;
    staffOnly?: boolean;
    labels?: Messages['tapestry'];
};

type PublicHand = {
    name: string;
    column: number | null;
    row: number | null;
};

type CompositeLayout = {
    revision: number;
    columns: number;
    rows: number;
    tileSizePx: number;
};

type HandsSnapshot = {
    hands: PublicHand[];
    layout: CompositeLayout | null;
};

const EMPTY_HANDS: HandsSnapshot = { hands: [], layout: null };

export default function ThumbnailTapestry({ sessionId, staffOnly = false, labels }: Props) {
    if (labels) {
        return <ThumbnailTapestryView sessionId={sessionId} staffOnly={staffOnly} labels={labels} />;
    }
    return <LocalizedThumbnailTapestry sessionId={sessionId} staffOnly={staffOnly} />;
}

function LocalizedThumbnailTapestry({ sessionId, staffOnly = false }: Props) {
    const { copy } = useLocale();
    return <ThumbnailTapestryView sessionId={sessionId} staffOnly={staffOnly} labels={copy.tapestry} />;
}

function parseHands(body: unknown): HandsSnapshot {
    const raw = body as {
        hands?: Array<{ name?: unknown; column?: unknown; row?: unknown }>;
        layout?: Partial<CompositeLayout> | null;
    };
    const hands = Array.isArray(raw?.hands)
        ? raw.hands.flatMap((hand) => {
            const name = typeof hand.name === 'string' ? hand.name.trim() : '';
            if (!name) return [];
            const column = typeof hand.column === 'number' ? hand.column : null;
            const row = typeof hand.row === 'number' ? hand.row : null;
            return [{ name, column, row }];
        })
        : [];
    const layout = raw?.layout &&
        typeof raw.layout.revision === 'number' &&
        typeof raw.layout.columns === 'number' &&
        typeof raw.layout.rows === 'number' &&
        raw.layout.columns > 0 &&
        raw.layout.rows > 0
        ? {
            revision: raw.layout.revision,
            columns: raw.layout.columns,
            rows: raw.layout.rows,
            tileSizePx: typeof raw.layout.tileSizePx === 'number' ? raw.layout.tileSizePx : 0,
        }
        : null;
    return { hands, layout };
}

const POLL_MS = 2_000;
/**
 * Bounded correlation attempts per cycle (TAP-02 re-review): the composite
 * and the hands sidecar are one correlated visual unit, so a mismatched pair
 * is retried immediately, never more than this per cycle, never
 * proportionally to the participant count.
 */
const MAX_CORRELATION_ATTEMPTS = 3;

/**
 * One accepted cycle: image, build revision and hands snapshot are only ever
 * published together. The overlay check at render suppresses name tags on
 * any pair whose layout revision disagrees with the image, while the
 * accessible names line always reflects the freshest accepted hands — so
 * lowering a hand or leaving retires the name with priority, and a tag can
 * never sit on the wrong person's cell.
 */
type TapestryView = {
    compositeUrl: string | null;
    buildRevision: string | null;
    hands: HandsSnapshot;
};

function ThumbnailTapestryView({
    sessionId,
    staffOnly,
    labels,
}: Props & { labels: Messages['tapestry'] }) {
    const [view, setView] = useState<TapestryView | null>(null);

    useEffect(() => {
        let active = true;
        let generation = 0;
        let controller: AbortController | null = null;
        // The ONE object URL the visible state currently owns. Any URL not
        // transferred here is revoked by the cycle that created it.
        let publishedUrl: string | null = null;

        // Session-scoped reset: never carry image, names or overlays across
        // a sessionId change. The next session starts from empty — if its
        // first fetch fails, the UI shows ITS waiting state, never the
        // previous session's data.
        setView(null);

        const compositeUrl = `/api/tapestry/${encodeURIComponent(sessionId)}`;
        // Raised-hand names ride a cookie-authorized sidecar: the collective
        // JPEG stays anonymous, and only people who chose to request the
        // floor are named, only while connected. Staff tools (staffOnly)
        // keep their original composite-only fetch contract.
        const handsUrl = `/api/scheduled-sessions/${encodeURIComponent(sessionId)}/tapestry/hands`;

        const fetchHands = async (signal: AbortSignal): Promise<HandsSnapshot> => {
            const response = await fetch(handsUrl, {
                cache: 'no-store', credentials: 'same-origin', signal,
            });
            // A rejection (expired/left session) retires names with priority;
            // only a network-level failure keeps the previous snapshot.
            if (!response.ok) return EMPTY_HANDS;
            return parseHands(await response.json());
        };

        // ONE coordinator for the whole visual unit: composite first, hands
        // immediately after, published only as one accepted cycle's result.
        const cycle = async () => {
            if (!active) return;
            const myGeneration = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;

            // Every object URL created this cycle is registered here.
            // Exactly one may be chosen and transferred to the visible state;
            // all others are revoked exactly once before the cycle returns.
            const candidates: Array<{ url: string; revision: string | null; hands: HandsSnapshot }> = [];
            let chosen: (typeof candidates)[number] | null = null;

            for (let attempt = 0; attempt < MAX_CORRELATION_ATTEMPTS; attempt += 1) {
                if (!active || myGeneration !== generation) break;
                let url: string | null = null;
                try {
                    const compositeRes = await fetch(compositeUrl, {
                        cache: 'no-store',
                        credentials: staffOnly ? 'same-origin' : 'omit',
                        signal,
                    });
                    if (!compositeRes.ok) break; // keep previous image; hands still refresh below
                    const revision = compositeRes.headers.get('x-tapestry-revision');
                    const blob = await compositeRes.blob();
                    if (!active || myGeneration !== generation) {
                        // Superseded or unmounted mid-read: stop before
                        // spending the sidecar fetch or creating any blob.
                        return;
                    }
                    url = URL.createObjectURL(blob);
                    const hands = staffOnly ? EMPTY_HANDS : await fetchHands(signal);
                    candidates.push({ url, revision, hands });
                    url = null; // ownership moved into the candidates registry
                    const layoutRevision = hands.layout?.revision ?? null;
                    if (staffOnly || layoutRevision === null || String(layoutRevision) === revision) {
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
            // revision check keeps its tags hidden while mismatched.
            if (!chosen && candidates.length > 0) chosen = candidates[candidates.length - 1];
            // Revoke every non-chosen candidate exactly once.
            for (const c of candidates) {
                if (c !== chosen) URL.revokeObjectURL(c.url);
            }

            if (!active || myGeneration !== generation) {
                // A stale generation discards its chosen URL before dying.
                if (chosen) URL.revokeObjectURL(chosen.url);
                return;
            }

            if (!chosen) {
                // Composite unavailable: keep the previous image, still
                // refresh names so departures retire them.
                if (staffOnly) return;
                try {
                    const hands = await fetchHands(signal);
                    if (!active || myGeneration !== generation) return;
                    setView((prev) => ({
                        compositeUrl: prev?.compositeUrl ?? null,
                        buildRevision: prev?.buildRevision ?? null,
                        hands,
                    }));
                } catch { /* transient: next tick retries */ }
                return;
            }

            setView({
                compositeUrl: chosen.url,
                buildRevision: chosen.revision,
                hands: chosen.hands,
            });
            // Ownership transfer, outside the state updater: the chosen URL
            // now belongs to the visible state; the retired one is revoked
            // exactly once, here or at cleanup.
            const retired = publishedUrl;
            publishedUrl = chosen.url;
            if (retired && retired !== chosen.url) URL.revokeObjectURL(retired);
        };

        void cycle();
        const timer = setInterval(() => void cycle(), POLL_MS);
        return () => {
            active = false;
            clearInterval(timer);
            controller?.abort();
            if (publishedUrl) {
                URL.revokeObjectURL(publishedUrl);
                publishedUrl = null;
            }
        };
    }, [sessionId, staffOnly]);

    const names = (view?.hands ?? EMPTY_HANDS).hands.map((hand) => hand.name);
    // Zoom/Meet-style name tags over each raised hand's own tile. The layout
    // and the composite must name the same build — otherwise the grid may
    // have shifted and a tag could land on the wrong person, so we omit the
    // overlay (the accessible names line below remains either way).
    const layout = view !== null &&
        view.buildRevision !== null &&
        view.hands.layout !== null &&
        String(view.hands.layout.revision) === view.buildRevision
        ? view.hands.layout
        : null;
    const overlayHands = layout && view
        ? view.hands.hands.filter((hand) => hand.column !== null && hand.row !== null)
        : [];
    const src = view?.compositeUrl ?? null;
    return <section aria-label={labels.label} className="w-full">
        <h2 className="mb-2 text-sm font-medium text-[var(--cream)]">{labels.label}</h2>
        {src ? (
            <div className="relative inline-block max-w-full">
                {/* The composite is sized to the active participant set; render
                    at natural size (capped by the container) instead of
                    stretching. Percentage-positioned tags scale with it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={labels.latestAlt} className="block max-w-full rounded-lg border border-[var(--border-subtle)]" />
                {overlayHands.length > 0 && layout ? (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                        {overlayHands.map((hand) => (
                            <span
                                key={`${hand.name}-${hand.column}-${hand.row}`}
                                className="absolute left-0 top-0 max-w-[33%] rounded bg-black/70 px-1.5 py-0.5 text-xs leading-4 text-[var(--cream)]"
                                style={{
                                    left: `${((hand.column ?? 0) / layout.columns) * 100}%`,
                                    top: `${(((hand.row ?? 0) + 1) / layout.rows) * 100}%`,
                                    transform: 'translateY(-100%)',
                                }}
                            >
                                {hand.name}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        ) : <p className="text-xs text-[var(--text-muted)]">{labels.waiting}</p>}
        {names.length > 0 ? (
            <p aria-live="polite" className="mt-2 text-xs text-[var(--gold)]">
                {labels.raisedHands.replace('{names}', names.join(', '))}
            </p>
        ) : null}
    </section>;
}
