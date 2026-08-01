'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { messages, type Messages } from '@/lib/i18n';

type Props = { sessionId: string; staffOnly?: boolean };

export default function ThumbnailTapestry({ sessionId, staffOnly = false }: Props) {
    if (staffOnly) {
        // The ops board is intentionally outside this attendee-localization
        // slice. Preserve its existing English labels and standalone tests.
        return <ThumbnailTapestryView sessionId={sessionId} staffOnly labels={messages.en.tapestry} />;
    }
    return <LocalizedThumbnailTapestry sessionId={sessionId} />;
}

function LocalizedThumbnailTapestry({ sessionId }: { sessionId: string }) {
    const { copy } = useLocale();
    return <ThumbnailTapestryView sessionId={sessionId} staffOnly={false} labels={copy.tapestry} />;
}

function ThumbnailTapestryView({
    sessionId,
    staffOnly,
    labels,
}: Props & { labels: Messages['tapestry'] }) {
    const [src, setSrc] = useState<string | null>(null);
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
    return <section aria-label={labels.label} className="w-full">
        <h2 className="mb-2 text-sm font-medium text-[var(--cream)]">{labels.label}</h2>
        {src ? (
            // The composite is sized to the active participant set; render at
            // natural size (capped by the container) instead of stretching.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={labels.latestAlt} className="max-w-full rounded-lg border border-[var(--border-subtle)]" />
        ) : <p className="text-xs text-[var(--text-muted)]">{labels.waiting}</p>}
    </section>;
}
