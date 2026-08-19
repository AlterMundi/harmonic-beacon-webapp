'use client';

import { useEffect } from 'react';

import { reloadListenerIdentityDocument } from '@/lib/listener/identity-cache-boundary';

export const LISTENER_IDENTITY_STALE_ATTRIBUTE = 'data-hb-listener-identity-stale';

/**
 * Keep an Account-derived Listener document out of a stale visual state.
 *
 * The server response is already private/no-store. This boundary also covers
 * browsers that elect to retain such a page in their back-forward cache: the
 * outgoing document is made neutral before its snapshot, and a persisted
 * restoration is reloaded before any prior profile or entitlement is shown.
 */
export function ListenerIdentityCacheBoundary() {
    useEffect(() => {
        const root = document.documentElement;
        root.removeAttribute(LISTENER_IDENTITY_STALE_ATTRIBUTE);

        const onPageHide = () => {
            root.setAttribute(LISTENER_IDENTITY_STALE_ATTRIBUTE, '1');
        };
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted || root.hasAttribute(LISTENER_IDENTITY_STALE_ATTRIBUTE)) {
                reloadListenerIdentityDocument();
            }
        };

        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
            root.removeAttribute(LISTENER_IDENTITY_STALE_ATTRIBUTE);
        };
    }, []);

    return null;
}
