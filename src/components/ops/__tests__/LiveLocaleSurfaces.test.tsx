// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
