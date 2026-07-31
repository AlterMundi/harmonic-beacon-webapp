'use client';

import { useEffect, useState } from 'react';

type Props = { sessionId: string; staffOnly?: boolean };

export default function ThumbnailTapestry({ sessionId, staffOnly = false }: Props) {
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
    return <section aria-label="Tapestry" className="w-full">
        <h2 className="mb-2 text-sm font-medium text-[var(--cream)]">Tapestry</h2>
        {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            // The composite is sized to the active participant set; render at
            // natural size (capped by the container) instead of stretching.
            <img src={src} alt="Latest participant tapestry" className="max-w-full rounded-lg border border-[var(--border-subtle)]" />
        ) : <p className="text-xs text-[var(--text-muted)]">Waiting for snapshots.</p>}
    </section>;
}
