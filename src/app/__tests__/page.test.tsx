// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The public landing page: the two event times, where to buy, and the code +
 * email form. Bilingual because both audiences arrive at the same URL.
 */

vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const loginFormProps = vi.fn();
vi.mock('@/app/login/LoginClient', () => ({
    default: (props: { next?: string }) => {
        loginFormProps(props);
        return <form data-testid="ticket-login-form" />;
    },
}));

const SATURDAY = {
    id: 'session-1',
    language: 'SPANISH' as const,
    scheduledAt: new Date('2026-08-01T14:30:00.000Z'),
};
const SESSION_2 = {
    id: 'session-2',
    language: 'ENGLISH' as const,
    scheduledAt: new Date('2026-08-01T18:30:00.000Z'),
};

function mountDb(findMany: ReturnType<typeof vi.fn>) {
    const prisma = { scheduledSession: { findMany } };
    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    return findMany;
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
    const { default: LandingPage } = await import('../page');
    render(await LandingPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('landing page', () => {
    beforeEach(() => {
        vi.resetModules();
        loginFormProps.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllEnvs();
        vi.doUnmock('@/lib/db');
        vi.restoreAllMocks();
    });

    it('shows both sessions with their language and time', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.getByText('In English')).toBeInTheDocument();
        expect(screen.getByText('En español')).toBeInTheDocument();

        // The event's advertised Costa Rica time comes first, with operator and
        // universal references explicitly labelled below it.
        expect(screen.getAllByText(/Costa Rica:/)).toHaveLength(2);
        expect(screen.getByText(/Saturday, August 1 at 12:30 PM CST/)).toBeInTheDocument();
        expect(screen.getByText(/sábado, 1 de agosto.*08:30.*GMT-6/)).toBeInTheDocument();
        expect(screen.getAllByText(/Argentina:/)).toHaveLength(2);
        expect(screen.getAllByText(/UTC:/)).toHaveLength(2);
    });

    it('asks only for sessions an attendee could still join', async () => {
        const findMany = mountDb(vi.fn().mockResolvedValue([]));
        await renderPage();

        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { status: { in: ['SCHEDULED', 'LIVE'] } } }),
        );
        // No paid-mode or attendee-cap columns leak into the public page.
        const select = findMany.mock.calls[0][0].select;
        expect(Object.keys(select).sort()).toEqual(['id', 'language', 'scheduledAt']);
    });

    it('still offers the login form when the schedule cannot be read', async () => {
        mountDb(vi.fn().mockRejectedValue(new Error('connection refused')));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await renderPage();

        expect(screen.getByTestId('ticket-login-form')).toBeInTheDocument();
        expect(screen.getByText(/Session times are temporarily unavailable/)).toBeInTheDocument();
        expect(screen.getByText(/Los horarios no están disponibles/)).toBeInTheDocument();
        expect(error).toHaveBeenCalled();
    });

    it('renders the purchase link when one is configured', async () => {
        vi.stubEnv('TICKET_PURCHASE_URL', 'https://tickets.example.invalid/harmonic-beacon');
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        const link = screen.getByRole('link', { name: /Buy a ticket/ });
        expect(link).toHaveAttribute('href', 'https://tickets.example.invalid/harmonic-beacon');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
        expect(screen.getByText(/USD \$50 Global North.*USD \$20 Global South/)).toBeInTheDocument();
    });

    it('says sales open shortly while the external platform is still TBD', async () => {
        vi.stubEnv('TICKET_PURCHASE_URL', '');
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.queryByRole('link', { name: /Buy a ticket/ })).toBeNull();
        expect(screen.getByText(/Ticket sales open shortly/)).toBeInTheDocument();
        expect(screen.getByText(/Las entradas se abren en breve/)).toBeInTheDocument();
    });

    it('passes a room path through to the form so a reconnect returns there', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY]));
        await renderPage({ next: '/session/session-saturday' });

        expect(loginFormProps).toHaveBeenCalledWith({ next: '/session/session-saturday' });
    });

    it('drops a next parameter that is not one of this app\'s room paths', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY]));

        for (const next of [
            'https://evil.example/steal',
            '//evil.example/steal',
            '/admin',
            '/session/../admin',
            '\\evil.example',
            'session/session-saturday',
        ]) {
            await renderPage({ next });
            expect(loginFormProps).toHaveBeenLastCalledWith({ next: undefined });
            cleanup();
            vi.resetModules();
            mountDb(vi.fn().mockResolvedValue([SATURDAY]));
        }
    });

    it('links to the staff sign-in page', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.getByRole('link', { name: /Staff sign-in/ })).toHaveAttribute('href', '/staff/login');
    });
});
