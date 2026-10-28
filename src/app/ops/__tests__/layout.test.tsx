// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ get: () => ({ value: 'staff-token' }) }),
}));
const navigation = vi.hoisted(() => ({ pathname: '/ops/events' }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => navigation.pathname }));
vi.mock('@/lib/ops-auth', () => ({
    resolveStaffByToken: vi.fn().mockResolvedValue({
        id: 'fac-op-1',
        email: 'julian@example.invalid',
        name: 'Julián',
        role: 'FACILITATOR_OP',
    }),
}));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: vi.fn().mockResolvedValue('es') }));
vi.mock('@/components/ops/OpsNavLinks', () => ({
    default: ({ links }: { links: Array<{ href: string; label: string }> }) => (
        <div data-testid="nav-links">
            {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        </div>
    ),
}));
import OpsLayout from '../layout';
import { LocaleProvider } from '@/context/LocaleContext';

describe('staff layout', () => {
    afterEach(() => { cleanup(); navigation.pathname = '/ops/events'; });

    it('has one stable event hub entry without a second identity control', async () => {
        render(<LocaleProvider initialLocale="es">{await OpsLayout({ children: <p>child</p> })}</LocaleProvider>);

        const nav = screen.getByTestId('nav-links');
        expect(nav.querySelectorAll('a')).toHaveLength(3);
        expect(screen.getAllByRole('link', { name: 'Eventos' })).toHaveLength(1);
        expect(screen.queryByRole('link', { name: /Room|Spotlight/ })).toBeNull();
        expect(screen.queryByTestId('identity')).toBeNull();
        expect(document.querySelectorAll('summary')).toHaveLength(0);
    });

    it('keeps the staff room without the separate operations-site navigation', async () => {
        navigation.pathname = '/ops/events/event-1';
        render(<LocaleProvider initialLocale="es">{await OpsLayout({ children: <p>Room controls</p> })}</LocaleProvider>);
        expect(screen.queryByRole('navigation')).toBeNull();
        expect(screen.queryByTestId('nav-links')).toBeNull();
        expect(screen.getByText('Room controls')).toBeVisible();
    });
});
