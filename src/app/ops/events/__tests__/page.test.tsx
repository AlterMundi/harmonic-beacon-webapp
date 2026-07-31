// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        <a href={href} {...props}>{children}</a>,
}));

const mocks = vi.hoisted(() => ({
    resolveStaffByToken: vi.fn(),
    listStaffEvents: vi.fn(),
}));
vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ get: () => ({ value: 'staff-token' }) }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/ops-auth', () => ({ resolveStaffByToken: mocks.resolveStaffByToken }));
vi.mock('@/lib/staff-navigation', async () => {
    const actual = await vi.importActual<typeof import('@/lib/staff-navigation')>('@/lib/staff-navigation');
    return { ...actual, listStaffEvents: mocks.listStaffEvents };
});
vi.mock('@/lib/i18n-server', () => ({ requestLocale: vi.fn().mockResolvedValue('en') }));

import EventsHubPage from '../page';

const base = {
    language: 'SPANISH' as const,
    status: 'SCHEDULED' as const,
    scheduledAt: new Date('2026-08-01T18:00:00.000Z'),
    startedAt: null,
    facilitatorId: 'fac-1',
    facilitator: { name: 'Julián' },
};

describe('staff event hub', () => {
    beforeEach(() => {
        mocks.resolveStaffByToken.mockResolvedValue({
            id: 'admin-1',
            name: 'Nico',
            email: 'nico@example.invalid',
            role: 'ADMIN',
        });
        mocks.listStaffEvents.mockReset();
    });

    afterEach(cleanup);

    it('renders exactly one canonical link per event and keeps durable tests collapsed', async () => {
        mocks.listStaffEvents.mockResolvedValue([
            { ...base, id: 'live-real', title: 'Renamed from test', status: 'LIVE', isTest: false },
            { ...base, id: 'fixture', title: 'Public-looking title', isTest: true },
        ]);
        render(await EventsHubPage());

        expect(screen.getAllByRole('link', { name: /Renamed from test/ })).toHaveLength(1);
        expect(screen.getAllByRole('link', { name: /Public-looking title/ })).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Renamed from test/ })).toHaveAttribute(
            'href',
            '/ops/events/live-real',
        );
        expect(screen.queryByRole('link', { name: /Room|Spotlight/ })).toBeNull();

        const testRegion = screen.getByText(/Test events/).closest('details');
        expect(testRegion).not.toHaveAttribute('open');
        expect(within(testRegion!).getByRole('link', { name: /Public-looking title/ }))
            .toHaveAttribute('href', '/ops/events/fixture');
    });

    it('shows a useful empty state without exposing global events to a scoped user', async () => {
        mocks.resolveStaffByToken.mockResolvedValue({
            id: 'fac-1', name: 'Julián', email: 'fac@example.invalid', role: 'FACILITATOR',
        });
        mocks.listStaffEvents.mockResolvedValue([]);
        render(await EventsHubPage());

        expect(mocks.listStaffEvents).toHaveBeenCalledWith(expect.objectContaining({
            id: 'fac-1', role: 'FACILITATOR',
        }));
        expect(screen.getByText(/no active or upcoming events/i)).toBeInTheDocument();
    });
});
