'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** No UI, storage, fingerprinting or third-party analytics. */
export function CohortVisitObserver() {
    const pathname = usePathname();
    useEffect(() => {
        const surface = pathname === '/' ? 'landing'
            : /^\/session(?:\/[A-Za-z0-9_-]+)*$/.test(pathname ?? '') ? 'session' : null;
        if (!surface) return;
        let busy = false;
        let stopped = false;
        const controller = new AbortController();
        const observe = async () => {
            if (stopped || busy || document.visibilityState !== 'visible') return;
            busy = true;
            try {
                await fetch('/api/cohort-visits', {
                    method: 'POST', credentials: 'same-origin', cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ surface }), signal: controller.signal,
                });
            } catch { /* Best effort; never interrupt entry/audio/navigation. */ }
            finally { busy = false; }
        };
        void observe();
        const timer = window.setInterval(() => void observe(), 60_000);
        const visible = () => { void observe(); };
        document.addEventListener('visibilitychange', visible);
        return () => {
            stopped = true;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
            controller.abort();
        };
    }, [pathname]);
    return null;
}
