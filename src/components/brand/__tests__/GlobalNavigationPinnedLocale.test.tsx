// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import { GlobalNavigation } from '../GlobalNavigation';

const asset = readFileSync('public/assets/hb-global-nav.js', 'utf8');
afterEach(() => {
    cleanup();
    history.replaceState(null, '', '/');
    localStorage.clear();
    document.cookie = 'hb_locale=; Path=/; Max-Age=0';
});

it.each(['/session/event-1', '/ops/events/event-1/'])('retains focused language control and mobile state across pinned redraws on %s', async path => {
    history.replaceState(null, '', path);
    render(<LocaleProvider initialLocale="en"><GlobalNavigation active="events" locale="en" allowRemoteEnhancement={false} /></LocaleProvider>);
    // Execute the unchanged dependency, including its document-attribute observer.
    window.eval(asset);
    const host = document.querySelector('hb-global-nav')!;
    const root = host.shadowRoot!;
    for (const open of [true, false]) {
        if (open) fireEvent.click(root.querySelector('.toggle')!);
        for (const locale of ['es', 'en']) {
            const before = root.querySelector<HTMLButtonElement>('button.language')!;
            before.focus();
            expect(root.activeElement).toBe(before);
            await act(async () => {
                fireEvent.click(before);
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            const current = root.querySelector<HTMLButtonElement>('button.language')!;
            expect(document.documentElement.lang).toBe(locale);
            expect(document.querySelector('hb-global-nav')).toBe(host);
            expect(current).not.toBe(before);
            expect(before.isConnected).toBe(false);
            expect(root.activeElement).toBe(current);
            expect(document.activeElement).toBe(host);
            expect(root.querySelector('.mobile')!.classList.contains('open')).toBe(open);
            expect(root.querySelector('.toggle')).toHaveAttribute('aria-expanded', String(open));
        }
        if (open) fireEvent.click(root.querySelector('.toggle')!);
    }
});
