// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        <a href={href} {...props}>{children}</a>,
}));
const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    resolveStaffByToken: vi.fn(),
    resolveStaffLanding: vi.fn(),
}));
vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ get: () => ({ value: 'staff-token' }) }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { scheduledSession: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/ops-auth', () => ({ resolveStaffByToken: mocks.resolveStaffByToken }));
vi.mock('@/lib/staff-navigation', () => ({ resolveStaffLanding: mocks.resolveStaffLanding }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: vi.fn().mockResolvedValue('en') }));
vi.mock('@/components/ops/ConductorCockpit', () => ({
    default: ({ session }: { session: { id: string } }) => <div data-testid="cockpit">{session.id}</div>,
}));

import EventPage from '../page';

describe('canonical staff event page', () => {
    beforeEach(() => {
        mocks.resolveStaffByToken.mockResolvedValue({
            id: 'fac-1', name: 'Julián', email: 'fac@example.invalid', role: 'FACILITATOR',
        });
        mocks.resolveStaffLanding.mockResolvedValue('/ops/events/assigned-live');
        mocks.findUnique.mockReset();
    });
    afterEach(cleanup);

    it('composes room entry and conductor controls under one canonical event route', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'event-1',
            title: 'The living scene',
            language: 'ENGLISH',
            status: 'LIVE',
            scheduledAt: new Date('2026-08-01T18:00:00.000Z'),
            facilitatorId: 'fac-1',
        });
        render(await EventPage({ params: Promise.resolve({ id: 'event-1' }) }));

        expect(screen.getByRole('heading', { name: 'The living scene' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Enter the room/ })).toBeNull();
        expect(screen.getByTestId('cockpit')).toHaveTextContent('event-1');
    });

    it('recovers from inaccessible IDs without leaking their title or facilitator', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'secret-event',
            title: 'Private event title',
            language: 'ENGLISH',
            status: 'LIVE',
            scheduledAt: new Date(),
            facilitatorId: 'someone-else',
        });
        render(await EventPage({ params: Promise.resolve({ id: 'secret-event' }) }));

        expect(screen.getByRole('heading', { name: /unavailable/i })).toBeInTheDocument();
        expect(screen.queryByText(/Private event title/)).toBeNull();
        expect(screen.getByRole('link', { name: /Return to your events/ })).toHaveAttribute(
            'href', '/ops/events/assigned-live',
        );
    });

    it('gives stale and ended IDs the same non-disclosing recovery surface', async () => {
        mocks.findUnique.mockResolvedValue(null);
        const { unmount } = render(await EventPage({ params: Promise.resolve({ id: 'gone' }) }));
        expect(screen.getByText(/No event details were disclosed/)).toBeInTheDocument();
        unmount();

        mocks.findUnique.mockResolvedValue({
            id: 'ended', title: 'Ended secret', language: 'SPANISH', status: 'ENDED',
            scheduledAt: new Date(), facilitatorId: 'fac-1',
        });
        render(await EventPage({ params: Promise.resolve({ id: 'ended' }) }));
        expect(screen.queryByText('Ended secret')).toBeNull();
    });
});
