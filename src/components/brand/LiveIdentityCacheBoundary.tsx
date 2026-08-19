'use client';

import { useEffect } from 'react';

import { reloadLiveIdentityDocument } from '@/lib/brand/live-identity-cache-boundary';

export const LIVE_IDENTITY_STALE_ATTRIBUTE = 'data-hb-live-identity-stale';

/**
 * Prevent a browser back-forward cache snapshot from restoring a stale local
 * Account name or staff shortcut after logout/account switching.
 */
export function LiveIdentityCacheBoundary() {
    useEffect(() => {
        const root = document.documentElement;
        root.removeAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE);

        const onPageHide = () => {
            root.setAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE, '1');
        };
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted || root.hasAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE)) {
                reloadLiveIdentityDocument();
            }
        };

        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
            root.removeAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE);
        };
    }, []);

    return null;
}
