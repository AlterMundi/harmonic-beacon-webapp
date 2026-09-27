// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import LanguageControl from '@/components/brand/LanguageControl';
import { EventHeading, OpsNavigation } from '../LiveLocaleSurfaces';
vi.mock('next/navigation', () => ({ usePathname: () => '/ops/events/event-1', useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); localStorage.clear(); document.cookie = 'hb_locale=; Path=/; Max-Age=0'; });
it('updates the Staff event heading and navigation without refreshing server data', () => {
    render(<LocaleProvider initialLocale="en"><LanguageControl /><OpsNavigation analytics={false} /><EventHeading title="Living scene" language="SPANISH" status="LIVE" scheduledAt="2026-08-01T18:00:00.000Z" /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'ES' }));
    expect(screen.getByRole('navigation', { name: 'Operaciones de eventos' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Eventos' })).toBeVisible();
    expect(screen.getByText('En vivo')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Living scene' })).toBeVisible();
});

it('hydrates the event time without recovery when server and browser timezones differ', async () => {
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    let environmentZone = 'UTC';
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function(locales, options) {
        return new NativeDateTimeFormat(locales, { timeZone: environmentZone, ...options });
    } as typeof Intl.DateTimeFormat);
    const content = <LocaleProvider initialLocale="en"><EventHeading title="Rehearsal" language="SPANISH" status="LIVE" scheduledAt="2026-09-30T16:00:00Z" /></LocaleProvider>;
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(content);
    environmentZone = 'America/Argentina/Cordoba';
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
        await act(async () => { root = hydrateRoot(container, content, { onRecoverableError: error => errors.push(error) }); });
        expect(errors).toEqual([]);
        expect(container.textContent).toContain('13:00');
    } finally {
        await act(async () => root?.unmount());
        container.remove();
        formatter.mockRestore();
    }
});
