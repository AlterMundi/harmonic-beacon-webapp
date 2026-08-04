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

function ThumbnailTapestryView({
    sessionId,
    staffOnly,
    labels,
}: Props & { labels: Messages['tapestry'] }) {
    const [src, setSrc] = useState<string | null>(null);
    const [compositeRevision, setCompositeRevision] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<HandsSnapshot>(EMPTY_HANDS);
    useEffect(() => {
        let active = true;
        let previous: string | null = null;
        const load = async () => {
            try {
                const response = await fetch(`/api/tapestry/${encodeURIComponent(sessionId)}`, {
                    cache: 'no-store', credentials: staffOnly ? 'same-origin' : 'omit',
                });
                if (!response.ok) return;
                const revision = response.headers.get('x-tapestry-revision');
                const next = URL.createObjectURL(await response.blob());
                if (!active) { URL.revokeObjectURL(next); return; }
                setSrc(next);
                setCompositeRevision(revision);
                if (previous) URL.revokeObjectURL(previous);
                previous = next;
            } catch { /* tapestry is optional */ }
        };
        void load();
        const timer = setInterval(() => void load(), 2_000);
        return () => { active = false; clearInterval(timer); if (previous) URL.revokeObjectURL(previous); };
    }, [sessionId, staffOnly]);
    useEffect(() => {
        // Raised-hand names ride a separate, cookie-authorized sidecar on the
        // public/room surface: the collective JPEG stays anonymous, and only
        // people who chose to request the floor are named, only while
        // connected. Staff tools (staffOnly) already have the operational
        // manifest and keep their original fetch contract. The list is
        // advisory — any rejection simply leaves it empty.
        if (staffOnly) return;
        let active = true;
        const load = async () => {
            try {
                const response = await fetch(
                    `/api/scheduled-sessions/${encodeURIComponent(sessionId)}/tapestry/hands`,
                    { cache: 'no-store', credentials: 'same-origin' },
                );
                if (!response.ok) return;
                const next = parseHands(await response.json());
                if (!active) return;
                setSnapshot(next);
            } catch { /* the hand list is advisory */ }
        };
        void load();
        const timer = setInterval(() => void load(), 5_000);
        return () => { active = false; clearInterval(timer); };
    }, [sessionId, staffOnly]);

    const names = snapshot.hands.map((hand) => hand.name);
    // Zoom/Meet-style name tags over each raised hand's own tile. The layout
    // and the composite must name the same build — otherwise the grid may
    // have shifted and a tag could land on the wrong person, so we omit the
    // overlay (the accessible names line below remains either way).
    const layout = compositeRevision !== null &&
        snapshot.layout !== null &&
        String(snapshot.layout.revision) === compositeRevision
        ? snapshot.layout
        : null;
    const overlayHands = layout
        ? snapshot.hands.filter((hand) => hand.column !== null && hand.row !== null)
        : [];

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
