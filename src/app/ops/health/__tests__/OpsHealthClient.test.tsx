// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperatorHealthReport } from '@/lib/ops-health';
import { messages } from '@/lib/i18n';

import OpsHealthClient from '../OpsHealthClient';

const englishProps = {
    locale: 'en' as const,
    copy: messages.en.ops.healthPanel,
    staffRoles: messages.en.staffRoles,
};

function makeReport(overrides: Partial<OperatorHealthReport> = {}): OperatorHealthReport {
    return {
        status: 'green',
        checkedAt: '2026-07-30T12:00:00.000Z',
        session: { id: 'session-1', title: 'Saturday EN session', status: 'LIVE' },
        checks: {
            postgres: { status: 'green', detail: 'PostgreSQL answered SELECT 1', latencyMs: 4 },
            livekit: { status: 'green', detail: 'LiveKit API answered (2 room(s))', latencyMs: 12 },
            stageRoom: { status: 'green', detail: 'Stage room exists', latencyMs: 0 },
            publisherGrants: { status: 'green', detail: '6/6 active publish grants', latencyMs: 3 },
            grantDelivery: { status: 'green', detail: 'No pending LiveKit grant effects', latencyMs: 2 },
            bedPublisher: { status: 'green', detail: 'Bed publisher live', latencyMs: 9 },
            tapestry: { status: 'green', detail: 'Tapestry health endpoint answered', latencyMs: 5 },
        },
        ...overrides,
    };
}

function mockFetchWith(report: OperatorHealthReport) {
    return vi.fn().mockResolvedValue({
        ok: true,
        json: async () => report,
    });
}

describe('OpsHealthClient', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchWith(makeReport()));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders the green board with every subsystem row', async () => {
        render(<OpsHealthClient role="OPERATOR" {...englishProps} />);

        await waitFor(() => {
            expect(screen.getByText(/GREEN — all subsystems nominal/)).toBeInTheDocument();
        });
        expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
        expect(screen.getByText('LiveKit API')).toBeInTheDocument();
        expect(screen.getByText('Stage room')).toBeInTheDocument();
        expect(screen.getByText('Publisher grants')).toBeInTheDocument();
        expect(screen.getByText('Bed publisher (playlist bot)')).toBeInTheDocument();
        expect(screen.getByText('Tapestry (cuttable)')).toBeInTheDocument();
        expect(screen.getByText(/Saturday EN session/)).toBeInTheDocument();
    });

    it('shows the red headline and the failing subsystem detail', async () => {
        const report = makeReport({
            status: 'red',
            checks: {
                ...makeReport().checks,
                bedPublisher: {
                    status: 'red',
                    detail: "Bed publisher 'playlist-bot' is not in room 'beacon'",
                    latencyMs: 8,
                    error: 'Error: room does not exist',
                },
            },
        });
        vi.stubGlobal('fetch', mockFetchWith(report));

        render(<OpsHealthClient role="ADMIN" {...englishProps} />);

        await waitFor(() => {
            expect(screen.getByText(/RED — launch-blocking subsystem failing/)).toBeInTheDocument();
        });
        expect(screen.getByText(/is not in room 'beacon'/)).toBeInTheDocument();
    });

    it('shows the yellow headline for a cuttable failure', async () => {
        const report = makeReport({
            status: 'yellow',
            checks: {
                ...makeReport().checks,
                tapestry: {
                    status: 'yellow',
                    detail: 'Tapestry unreachable — cuttable per the runbook',
                    latencyMs: 100,
                    error: 'Error: fetch failed',
                },
            },
        });
        vi.stubGlobal('fetch', mockFetchWith(report));

        render(<OpsHealthClient role="OPERATOR" {...englishProps} />);

        await waitFor(() => {
            expect(screen.getByText(/YELLOW — degraded/)).toBeInTheDocument();
        });
    });

    it('renders the selected session, levels, role and refresh action in Spanish', async () => {
        render(
            <OpsHealthClient
                role="FACILITATOR_OP"
                locale="es"
                copy={messages.es.ops.healthPanel}
                staffRoles={messages.es.staffRoles}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText(/VERDE — todos los subsistemas/)).toBeInTheDocument();
        });
        expect(screen.getByText('Sala de Escena')).toBeInTheDocument();
        expect(screen.getByText(/identidad activa: Facilitación y operaciones/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeInTheDocument();
    });

    it('treats an unreachable endpoint as its own red alarm', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('NetworkError')));

        render(<OpsHealthClient role="OPERATOR" {...englishProps} />);

        await waitFor(() => {
            expect(screen.getByText(/health endpoint unreachable/)).toBeInTheDocument();
        });
    });

    it('refetches when the operator asks for a refresh', async () => {
        const fetchMock = mockFetchWith(makeReport());
        vi.stubGlobal('fetch', fetchMock);

        render(<OpsHealthClient role="OPERATOR" {...englishProps} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
        // One staff-only tapestry refresh accompanies the initial health
        // report; the explicit health refresh adds the second board request.
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    });
});
