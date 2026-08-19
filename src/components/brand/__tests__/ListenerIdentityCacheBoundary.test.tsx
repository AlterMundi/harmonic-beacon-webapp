// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reloadListenerIdentityDocument = vi.hoisted(() => vi.fn());
vi.mock('@/lib/listener/identity-cache-boundary', () => ({
    reloadListenerIdentityDocument,
}));

import {
    LISTENER_IDENTITY_STALE_ATTRIBUTE,
    ListenerIdentityCacheBoundary,
} from '../ListenerIdentityCacheBoundary';

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): PageTransitionEvent {
    return new PageTransitionEvent(type, { persisted });
}

describe('Listener Account browser-cache boundary', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute(LISTENER_IDENTITY_STALE_ATTRIBUTE);
        reloadListenerIdentityDocument.mockReset();
    });

    afterEach(() => cleanup());

    it('neutralizes the outgoing Account-derived document before a history snapshot', () => {
        render(<ListenerIdentityCacheBoundary />);

        act(() => window.dispatchEvent(transition('pagehide', true)));

        expect(document.documentElement).toHaveAttribute(
            LISTENER_IDENTITY_STALE_ATTRIBUTE,
            '1',
        );
        expect(reloadListenerIdentityDocument).not.toHaveBeenCalled();
    });

    it('reloads a persisted restoration without first exposing the old identity', () => {
        render(<ListenerIdentityCacheBoundary />);
        act(() => window.dispatchEvent(transition('pagehide', true)));
        act(() => window.dispatchEvent(transition('pageshow', true)));

        expect(document.documentElement).toHaveAttribute(
            LISTENER_IDENTITY_STALE_ATTRIBUTE,
            '1',
        );
        expect(reloadListenerIdentityDocument).toHaveBeenCalledTimes(1);
    });

    it('does not reload a fresh, non-persisted document', () => {
        render(<ListenerIdentityCacheBoundary />);
        act(() => window.dispatchEvent(transition('pageshow', false)));

        expect(document.documentElement).not.toHaveAttribute(
            LISTENER_IDENTITY_STALE_ATTRIBUTE,
        );
        expect(reloadListenerIdentityDocument).not.toHaveBeenCalled();
    });
});
