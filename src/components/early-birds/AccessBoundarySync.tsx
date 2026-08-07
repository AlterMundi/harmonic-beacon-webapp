'use client';

import { useEffect } from 'react';

type AccessKind = 'membership' | 'free-window' | 'welcome' | 'denied';
const reloadPage = () => window.location.reload();

/**
 * Revalidates once at a server-computed authorization boundary. Stream grants
 * remain authoritative; this only keeps an already-open UI in sync without a
 * reload or a continuous polling loop.
 */
export default function AccessBoundarySync({
    expectedKind,
    boundaryAt,
    serverNow,
    onAccessChanged = reloadPage,
}: {
    expectedKind: AccessKind;
    boundaryAt: string | null;
    serverNow: string;
    onAccessChanged?: () => void;
}) {
    useEffect(() => {
        if (!boundaryAt) return;
        let cancelled = false;
        let inFlight = false;
        let timer: number | null = null;
        const mountedAt = Date.now();
        const boundaryDelay = new Date(boundaryAt).getTime() - new Date(serverNow).getTime();

        const revalidate = async () => {
            if (cancelled || inFlight) return;
            inFlight = true;
            if (timer !== null) window.clearTimeout(timer);
            try {
                const response = await fetch('/api/early-birds/access-state', {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                });
                if (cancelled) return;
                if (!response.ok) throw new Error('access state unavailable');
                const payload = await response.json() as {
                    access?: { kind?: AccessKind; allowedUntil?: string | null };
                };
                if (
                    payload.access?.kind !== expectedKind
                    || (expectedKind !== 'denied' && payload.access?.allowedUntil !== boundaryAt)
                ) {
                    onAccessChanged();
                    return;
                }
                // A client clock may be ahead of the server by a few seconds.
                timer = window.setTimeout(revalidate, 2_000);
            } catch {
                // Authorization and media leases still fail closed. Visibility
                // or pageshow will provide another bounded opportunity.
                timer = window.setTimeout(revalidate, 5_000);
            } finally {
                inFlight = false;
            }
        };

        const arm = () => {
            const elapsed = Date.now() - mountedAt;
            const remaining = Math.max(0, boundaryDelay - elapsed + 750);
            timer = window.setTimeout(revalidate, remaining);
        };
        const revalidateAfterResume = () => {
            const elapsed = Date.now() - mountedAt;
            if (document.visibilityState !== 'hidden' && elapsed + 750 >= boundaryDelay) {
                void revalidate();
            }
        };

        arm();
        window.addEventListener('pageshow', revalidateAfterResume);
        document.addEventListener('visibilitychange', revalidateAfterResume);
        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
            window.removeEventListener('pageshow', revalidateAfterResume);
            document.removeEventListener('visibilitychange', revalidateAfterResume);
        };
    }, [boundaryAt, expectedKind, onAccessChanged, serverNow]);

    return null;
}
