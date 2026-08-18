// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountClient, { completeFrontchannelLogout } from '../AccountClient';

describe('Account cross-product logout completion', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        cleanup();
        document.body.replaceChildren();
    });

    it('waits for every RP load/error and removes the isolated frames', async () => {
        const completion = completeFrontchannelLogout([
            'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            'https://live.harmonicbeacon.com/api/account/frontchannel-logout',
        ], document, 5_000);
        const frames = [...document.querySelectorAll('iframe')];
        expect(frames).toHaveLength(2);
        expect(frames.every((frame) => frame.referrerPolicy === 'no-referrer')).toBe(true);
        expect(frames.every((frame) => frame.hasAttribute('sandbox'))).toBe(true);
        frames[0].dispatchEvent(new Event('load'));
        let settled = false;
        void completion.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        frames[1].dispatchEvent(new Event('error'));
        await completion;
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('uses a bounded timeout if an RP never completes', async () => {
        vi.useFakeTimers();
        const completion = completeFrontchannelLogout([
            'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
        ], document, 5_000);
        await vi.advanceTimersByTimeAsync(5_000);
        await completion;
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('sends the rendered explicit locale instead of inferring document language', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        document.documentElement.lang = 'es';
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'listener@example.invalid' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-HB-Locale': 'en' });
    });
});
