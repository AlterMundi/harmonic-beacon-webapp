// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The public landing page: the two event times, where to buy, and the code +
 * email form. Locale is resolved once and only that language is rendered.
 */

vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/brand/LanguageControl', () => ({
    default: () => <div data-testid="language-control" />,
}));

const { requestLocaleMock } = vi.hoisted(() => ({ requestLocaleMock: vi.fn() }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: requestLocaleMock }));

const loginFormProps = vi.fn();
vi.mock('@/app/login/LoginClient', () => ({
    default: (props: { next?: string }) => {
        loginFormProps(props);
        return <form data-testid="ticket-login-form" />;
    },
}));

const SATURDAY = {
    id: 'session-1',
    title: 'Saturday',
    description: null,
    language: 'SPANISH' as const,
    scheduledAt: new Date('2026-08-08T14:30:00.000Z'),
    publicAccess: false,
};
const SESSION_2 = {
    id: 'session-2',
    title: 'Session 2',
    description: null,
    language: 'ENGLISH' as const,
    scheduledAt: new Date('2026-08-08T20:00:00.000Z'),
    publicAccess: false,
};
const NOW = new Date('2026-08-05T12:00:00.000Z');

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
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.resetModules();
        loginFormProps.mockClear();
        requestLocaleMock.mockReset();
        requestLocaleMock.mockResolvedValue('es');
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllEnvs();
        vi.doUnmock('@/lib/db');
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('shows both sessions with their language and time', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.getByText('Inglés')).toBeInTheDocument();
        expect(screen.getByText('Español')).toBeInTheDocument();

        // The event's advertised Costa Rica time comes first, with operator and
        // universal references explicitly labelled below it.
        expect(screen.getAllByText(/Costa Rica:/)).toHaveLength(2);
        expect(screen.getByText(/sábado, 8 de agosto.*08:30.*GMT-6/)).toBeInTheDocument();
        expect(screen.getByText(/sábado, 8 de agosto.*02:00 p\. m\..*GMT-6/)).toBeInTheDocument();
        expect(screen.getAllByText(/Argentina:/)).toHaveLength(2);
        expect(screen.getAllByText(/UTC:/)).toHaveLength(2);
    });

    it('does not place an animated purchase metaphor before complimentary access', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(document.querySelector('.portal-orbit')).toBeNull();
        expect(screen.queryByText('el regreso')).toBeNull();
        expect(screen.queryByText('PAGO → PRESENCIA')).toBeNull();
    });

    it('asks only for sessions an attendee could still join', async () => {
        const findMany = mountDb(vi.fn().mockResolvedValue([]));
        await renderPage();

        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    isTest: false,
                    endedAt: null,
                    OR: [
                        { status: 'SCHEDULED', scheduledAt: { gte: NOW } },
                        {
                            status: 'LIVE',
                            startedAt: { gte: new Date('2026-08-04T12:00:00.000Z') },
                        },
                    ],
                },
            }),
        );
        // No paid-mode or attendee-cap columns leak into the public page.
        const select = findMany.mock.calls[0][0].select;
        expect(Object.keys(select).sort()).toEqual([
            'description', 'id', 'language', 'publicAccess', 'scheduledAt', 'title',
        ]);
    });

    it('fails closed when a missed lifecycle transition leaves an old session LIVE', async () => {
        const findMany = mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        vi.stubEnv('TICKET_PURCHASE_URL', 'https://tickets.example.invalid/harmonic-beacon');

        await renderPage();

        const where = findMany.mock.calls[0][0].where;
        expect(where).toEqual(expect.objectContaining({
            isTest: false,
            endedAt: null,
            OR: expect.arrayContaining([
                {
                    status: 'LIVE',
                    startedAt: { gte: new Date('2026-08-04T12:00:00.000Z') },
                },
            ]),
        }));
        expect(where.OR[1].startedAt.gte.getTime()).toBeGreaterThan(
            new Date('2026-08-02T16:48:28.622Z').getTime(),
        );
        expect(screen.getAllByRole('link', { name: /Comprar entrada/ })).toHaveLength(2);
    });

    it('excludes test fixtures from public discovery and purchase links by durable data', async () => {
        const findMany = mountDb(vi.fn().mockResolvedValue([]));
        vi.stubEnv('TICKET_PURCHASE_URL', 'https://tickets.example.invalid/harmonic-beacon');

        await renderPage();

        expect(findMany.mock.calls[0][0].where.isTest).toBe(false);
        expect(screen.queryByRole('link', { name: /Comprar entrada/ })).toBeNull();
    });

    it('still offers the login form when the schedule cannot be read', async () => {
        mountDb(vi.fn().mockRejectedValue(new Error('connection refused')));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await renderPage();

        expect(screen.getByTestId('ticket-login-form')).toBeInTheDocument();
        expect(screen.getByText(/Los horarios no están disponibles/)).toBeInTheDocument();
        expect(error).toHaveBeenCalled();
    });

    it('renders the purchase link when one is configured', async () => {
        vi.stubEnv('TICKET_PURCHASE_URL', 'https://tickets.example.invalid/harmonic-beacon');
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        const links = screen.getAllByRole('link', { name: /Comprar entrada/ });
        expect(links[0]).toHaveAttribute('href', 'https://tickets.example.invalid/harmonic-beacon');
        expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
        expect(screen.getAllByText(/USD \$50 Norte Global.*USD \$20 Sur Global/)).toHaveLength(2);
    });

    it('presents a public event as free direct app access without ticket commerce', async () => {
        mountDb(vi.fn().mockResolvedValue([{
            ...SATURDAY,
            title: 'Del otro lado del umbral — Encuentro 1 de 4',
            description: 'Cuerpo, sonido y símbolo',
            publicAccess: true,
        }]));
        await renderPage();

        expect(screen.getByText('Del otro lado del umbral — Encuentro 1 de 4')).toBeInTheDocument();
        expect(screen.getByText('Gratis')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ingresar al evento' })).toHaveAttribute(
            'href',
            '/api/account/login?flow=attendee&next=%2Fsession%2Fsession-1',
        );
        expect(screen.queryByRole('link', { name: /Comprar entrada/ })).toBeNull();
        expect(screen.queryByTestId('ticket-login-form')).toBeNull();
    });

    it('makes upcoming gatherings the primary landing promise and links the wider experience below', async () => {
        mountDb(vi.fn().mockResolvedValue([{ ...SATURDAY, publicAccess: true }]));
        await renderPage();

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Próximos encuentros.');
        expect(screen.getByText(/Cuatro sábados para participar desde cualquier lugar/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Conocer la Proyección del Mito/ })).toHaveAttribute(
            'href',
            'https://proyecciondelmito.harmonicbeacon.com/',
        );
    });

    it('says sales open shortly while the external platform is still TBD', async () => {
        vi.stubEnv('TICKET_PURCHASE_URL', '');
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.queryByRole('link', { name: /Comprar entrada/ })).toBeNull();
        expect(screen.getAllByText(/Las entradas se abren en breve/).length).toBeGreaterThanOrEqual(1);
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

        expect(screen.getByRole('link', { name: /Ingreso del equipo/ })).toHaveAttribute('href', '/staff/login');
    });

    it('renders one coherent English surface when that locale is persisted', async () => {
        requestLocaleMock.mockResolvedValue('en');
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Upcoming gatherings.');
        expect(screen.getByText(/Four Saturdays to join from anywhere/)).toBeInTheDocument();
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('Spanish')).toBeInTheDocument();
        expect(screen.getByText(/Saturday, August 8 at 0?8:30 AM CST/)).toBeInTheDocument();
        expect(screen.queryByText(/El mito/)).toBeNull();
    });
});
