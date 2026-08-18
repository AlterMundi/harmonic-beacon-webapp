// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
};
const SESSION_2 = {
    id: 'session-2',
    title: 'Session 2',
    description: null,
    language: 'ENGLISH' as const,
    scheduledAt: new Date('2026-08-08T20:00:00.000Z'),
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

    it('shows both sessions and changes their local time by country', async () => {
        mountDb(vi.fn().mockResolvedValue([SATURDAY, SESSION_2]));
        await renderPage();

        expect(screen.getByText('Inglés')).toBeInTheDocument();
        expect(screen.getByText('Español')).toBeInTheDocument();

        const country = screen.getByLabelText('Ver horarios para');
        expect(country).toHaveValue('America/Argentina/Buenos_Aires');
        expect(Array.from(document.querySelectorAll('.event-local-time__primary')).map((node) => node.textContent)).toEqual([
            expect.stringMatching(/Argentina: sábado, 8 de agosto, 11:30 (ART|GMT-3)/),
            expect.stringMatching(/Argentina: sábado, 8 de agosto, 17:00 (ART|GMT-3)/),
        ]);
        expect(screen.getAllByText(/Referencia universal:/)).toHaveLength(2);

        fireEvent.change(country, { target: { value: 'America/Costa_Rica' } });

        expect(Array.from(document.querySelectorAll('.event-local-time__primary')).map((node) => node.textContent)).toEqual([
            expect.stringMatching(/Costa Rica: sábado, 8 de agosto, 08:30 GMT-6/),
            expect.stringMatching(/Costa Rica: sábado, 8 de agosto, 14:00 GMT-6/),
        ]);
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
        expect(Object.keys(select).sort()).toEqual(['description', 'id', 'language', 'scheduledAt', 'title']);
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

    it('publishes the four free Saturday rooms without ticket login', async () => {
        const dates = [
            ['50000000-0000-4000-8000-202608220001', '2026-08-22T14:00:00.000Z'],
            ['50000000-0000-4000-8000-202608290001', '2026-08-29T14:00:00.000Z'],
            ['50000000-0000-4000-8000-202609050001', '2026-09-05T14:00:00.000Z'],
            ['50000000-0000-4000-8000-202609120001', '2026-09-12T14:00:00.000Z'],
        ];
        mountDb(vi.fn().mockResolvedValue(dates.map(([id, scheduledAt], index) => ({
            id,
            title: `Del otro lado del umbral — Encuentro ${index + 1} de 4`,
            description: 'Ciclo gratuito en castellano',
            language: 'SPANISH' as const,
            scheduledAt: new Date(scheduledAt),
        }))));

        await renderPage();

        expect(screen.getAllByText('Gratis')).toHaveLength(4);
        expect(screen.getAllByRole('link', { name: 'Ingresar al evento' })).toHaveLength(4);
        expect(screen.queryByTestId('ticket-login-form')).toBeNull();
        for (const [id] of dates) {
            expect(document.querySelector(`a[href="/api/public-sessions/${id}/enter"]`)).not.toBeNull();
        }
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Próximos encuentros.');
        expect(screen.getByRole('link', { name: /Conocer la Proyección del Mito/ })).toHaveAttribute(
            'href',
            'https://harmonicbeacon.com/proyeccion-armonica-del-mito/',
        );

        fireEvent.change(screen.getByLabelText('Ver horarios para'), {
            target: { value: 'America/Santiago' },
        });
        expect(Array.from(document.querySelectorAll('.event-local-time__clock')).map((node) => node.textContent)).toEqual([
            '10:00',
            '10:00',
            '10:00',
            '11:00',
        ]);
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
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('Spanish')).toBeInTheDocument();
        expect(screen.getByLabelText('Show times for')).toHaveValue('America/Argentina/Buenos_Aires');
        expect(document.querySelector('.event-local-time__primary')).toHaveTextContent(
            /Argentina: Saturday 8 August at 11:30 (GMT-3|ART)/,
        );
        expect(screen.queryByText(/El mito/)).toBeNull();
    });
});
