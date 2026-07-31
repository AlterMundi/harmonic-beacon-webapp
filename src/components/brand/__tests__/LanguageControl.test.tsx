// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '@/components/brand/LanguageControl';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('LanguageControl', () => {
    beforeEach(() => {
        refresh.mockClear();
        window.localStorage.clear();
        document.cookie = 'hb_locale=; Path=/; Max-Age=0';
    });

    afterEach(cleanup);

    it('updates visible locale, document metadata, cookie and storage', async () => {
        const user = userEvent.setup();
        render(
            <LocaleProvider initialLocale="es">
                <LanguageControl />
            </LocaleProvider>,
        );

        const english = screen.getByRole('button', { name: 'EN' });
        expect(english).toHaveAttribute('aria-pressed', 'false');
        await user.click(english);

        expect(english).toHaveAttribute('aria-pressed', 'true');
        expect(document.documentElement.lang).toBe('en');
        expect(window.localStorage.getItem('hb-locale')).toBe('en');
        expect(document.cookie).toContain('hb_locale=en');
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
