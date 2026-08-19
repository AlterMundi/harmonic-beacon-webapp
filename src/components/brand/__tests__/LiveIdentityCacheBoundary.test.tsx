// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const reload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/brand/live-identity-cache-boundary', () => ({
    reloadLiveIdentityDocument: reload,
}));

import {
    LIVE_IDENTITY_STALE_ATTRIBUTE,
    LiveIdentityCacheBoundary,
} from '../LiveIdentityCacheBoundary';

describe('Live identity cache boundary', () => {
    afterEach(() => {
        document.documentElement.removeAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE);
        vi.clearAllMocks();
    });

    it('neutralizes an outgoing document and reloads a restored snapshot', () => {
        const view = render(<LiveIdentityCacheBoundary />);

        act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        expect(document.documentElement).toHaveAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE, '1');

        act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        expect(reload).toHaveBeenCalledTimes(1);

        view.unmount();
        expect(document.documentElement).not.toHaveAttribute(LIVE_IDENTITY_STALE_ATTRIBUTE);
    });
});
