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
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
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
vi.mock('@/components/ops/StaffIdentityMenu', () => ({
    default: ({ name, roleLabel, roleDescription }: { name: string; roleLabel: string; roleDescription: string }) => (
        <div data-testid="identity">{name} · {roleLabel} · {roleDescription}</div>
    ),
}));

import OpsLayout from '../layout';

describe('staff layout', () => {
    afterEach(cleanup);

    it('has one stable event hub entry and a truthful localized identity', async () => {
        render(await OpsLayout({ children: <p>child</p> }));

        const nav = screen.getByTestId('nav-links');
        expect(nav.querySelectorAll('a')).toHaveLength(3);
        expect(screen.getAllByRole('link', { name: 'Eventos' })).toHaveLength(1);
        expect(screen.queryByRole('link', { name: /Room|Spotlight/ })).toBeNull();
        expect(screen.getByTestId('identity')).toHaveTextContent(
            'Julián · Facilitación y operaciones',
        );
        expect(screen.getByTestId('identity')).toHaveTextContent(
            /Sólo en su evento asignado actúa como facilitación/,
        );
    });
});
