'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import type { Messages } from '@/lib/i18n';

type Props = {
    sessionId: string;
    staffOnly?: boolean;
    labels?: Messages['tapestry'];
};

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

function ThumbnailTapestryView({
    sessionId,
    staffOnly,
    labels,
}: Props & { labels: Messages['tapestry'] }) {
    const [src, setSrc] = useState<string | null>(null);
    const [raisedHands, setRaisedHands] = useState<string[]>([]);
    useEffect(() => {
        let active = true;
        let previous: string | null = null;
        const load = async () => {
            try {
                const response = await fetch(`/api/tapestry/${encodeURIComponent(sessionId)}`, {
                    cache: 'no-store', credentials: staffOnly ? 'same-origin' : 'omit',
                });
                if (!response.ok) return;
                const next = URL.createObjectURL(await response.blob());
                if (!active) { URL.revokeObjectURL(next); return; }
                setSrc(next);
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
                const body = await response.json() as { hands?: Array<{ name?: unknown }> };
                if (!active) return;
                const names = Array.isArray(body.hands)
                    ? body.hands
                        .map((hand) => typeof hand.name === 'string' ? hand.name.trim() : '')
                        .filter((name) => name.length > 0)
                    : [];
                setRaisedHands(names);
            } catch { /* the hand list is advisory */ }
        };
        void load();
        const timer = setInterval(() => void load(), 5_000);
        return () => { active = false; clearInterval(timer); };
    }, [sessionId, staffOnly]);
    return <section aria-label={labels.label} className="w-full">
        <h2 className="mb-2 text-sm font-medium text-[var(--cream)]">{labels.label}</h2>
        {src ? (
            // The composite is sized to the active participant set; render at
            // natural size (capped by the container) instead of stretching.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={labels.latestAlt} className="max-w-full rounded-lg border border-[var(--border-subtle)]" />
        ) : <p className="text-xs text-[var(--text-muted)]">{labels.waiting}</p>}
        {raisedHands.length > 0 ? (
            <p aria-live="polite" className="mt-2 text-xs text-[var(--gold)]">
                {labels.raisedHands.replace('{names}', raisedHands.join(', '))}
            </p>
        ) : null}
    </section>;
}
