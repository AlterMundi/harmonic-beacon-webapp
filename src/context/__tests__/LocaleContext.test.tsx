// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleProvider, useLocale } from '@/context/LocaleContext';

function Probe() {
    const { locale, setLocale, seedLocale } = useLocale();
    return (
        <div>
            <output aria-label="locale">{locale}</output>
            <button type="button" onClick={() => seedLocale('en')}>Seed English event</button>
            <button type="button" onClick={() => seedLocale('es')}>Seed Spanish event</button>
            <button type="button" onClick={() => setLocale('en')}>Choose English</button>
        </div>
    );
}

describe('LocaleProvider event-language seed', () => {
    beforeEach(() => {
        window.localStorage.clear();
        document.cookie = 'hb_locale=; Path=/; Max-Age=0';
    });

    afterEach(cleanup);

    it('uses event language on a first visit and persists that initial preference', async () => {
        const user = userEvent.setup();
        render(<LocaleProvider initialLocale="es"><Probe /></LocaleProvider>);

        await user.click(screen.getByRole('button', { name: 'Seed English event' }));

        expect(screen.getByLabelText('locale')).toHaveTextContent('en');
        expect(document.documentElement.lang).toBe('en');
        expect(document.cookie).toContain('hb_locale=en');
        expect(window.localStorage.getItem('hb-locale')).toBe('en');
    });

    it('does not override a persisted choice with the event language', async () => {
        const user = userEvent.setup();
        document.cookie = 'hb_locale=es; Path=/';
        window.localStorage.setItem('hb-locale', 'es');
        render(<LocaleProvider initialLocale="es"><Probe /></LocaleProvider>);

        await user.click(screen.getByRole('button', { name: 'Seed English event' }));

        expect(screen.getByLabelText('locale')).toHaveTextContent('es');
        expect(document.cookie).toContain('hb_locale=es');
    });

    it('cannot undo a choice made while the event response is in flight', async () => {
        const user = userEvent.setup();
        render(<LocaleProvider initialLocale="es"><Probe /></LocaleProvider>);

        await user.click(screen.getByRole('button', { name: 'Choose English' }));
        await user.click(screen.getByRole('button', { name: 'Seed Spanish event' }));

        expect(screen.getByLabelText('locale')).toHaveTextContent('en');
        expect(document.cookie).toContain('hb_locale=en');
    });
});
