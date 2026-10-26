// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import ListenerProfileSummary from '../ListenerProfileSummary';

const origin = 'https://listen.harmonicbeacon.com' as const;
const summary = (identityKey: string) => ({ version: 1, identityKey, listeningSeconds: 36_000, membership: { kind: 'founder', state: 'active' } });
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('profile account boundary', () => {
    it('hides the first account immediately while another account response is delayed', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(response(summary('account-a')))
            .mockImplementationOnce(() => new Promise(() => {}));
        vi.stubGlobal('fetch', fetch);
        const { rerender } = render(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey="account-a" /></LocaleProvider>);
        expect(await screen.findByText('Plus · Founding Listener')).toBeInTheDocument();
        rerender(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey="account-b" /></LocaleProvider>);
        expect(screen.queryByText('Plus · Founding Listener')).toBeNull();
        expect(screen.queryByText('10 h')).toBeNull();
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });
    it('hides prior data when identity is removed and never shows mismatched Listener data', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(summary('account-a'))));
        const { rerender } = render(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey="account-a" /></LocaleProvider>);
        await screen.findByText('Plus · Founding Listener');
        rerender(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey={null} /></LocaleProvider>);
        expect(screen.queryByText('Plus · Founding Listener')).toBeNull();
        rerender(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey="account-b" /></LocaleProvider>);
        await screen.findByText('Open Beacon Listen with this account to see your plan and hours.');
        expect(screen.queryByText('Plus · Founding Listener')).toBeNull();
    });
    it('keeps network failures distinct from a free membership', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
        render(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey="account-a" /></LocaleProvider>);
        await screen.findByText('Your membership is currently unavailable.');
        expect(screen.queryByText('Free')).toBeNull();
    });
    it('offers the Listen connection without an unusable refresh when no Account identity exists', () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        render(<LocaleProvider initialLocale="en"><ListenerProfileSummary origin={origin} identityKey={null} /></LocaleProvider>);
        expect(screen.getByRole('link', { name: /Open Beacon Listen/ })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Refresh status' })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
