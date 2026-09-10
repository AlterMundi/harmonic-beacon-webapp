// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '../LanguageControl';
import { GlobalNavigation } from '../GlobalNavigation';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); localStorage.clear(); document.cookie = 'hb_locale=; Path=/; Max-Age=0'; });
it('takes ownership of the real shadow language button on live routes before its reload handler', () => {
    history.replaceState(null, '', '/session/event-1');
    render(<LocaleProvider initialLocale="en"><GlobalNavigation active="events" locale="en" allowRemoteEnhancement={false} /></LocaleProvider>);
    const host = document.querySelector('hb-global-nav')!;
    const root = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button'); button.className = 'language';
    button.setAttribute('aria-label', 'Language / Idioma'); root.append(button);
    const reload = vi.fn(); button.addEventListener('click', reload);
    fireEvent.click(button);
    expect(reload).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe('es');
    expect(document.cookie).toContain('hb_locale=es');
});
it('updates fallback navigation copy and accessible names without remote enhancement', () => {
    render(<LocaleProvider initialLocale="en"><LanguageControl /><GlobalNavigation active="events" locale="en" allowRemoteEnhancement={false} /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'ES' }));
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Escuchar' })).toHaveAttribute('href', 'https://listen.harmonicbeacon.com/?lang=es');
});
