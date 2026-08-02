// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ComponentProps } from 'react';
import { messages } from '@/lib/i18n';
import AdmissionConsoleImpl from '../AdmissionConsole';

type AdmissionProps = Omit<ComponentProps<typeof AdmissionConsoleImpl>, 'locale' | 'copy'>;

function AdmissionConsole(props: AdmissionProps) {
    return <AdmissionConsoleImpl {...props} locale="en" copy={messages.en.ops.admissionPanel} />;
}

const EVENT = {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Spanish event',
    language: 'SPANISH',
    scheduledAt: '2026-08-08T14:30:00.000Z',
    attendeeCap: 150,
};
const CAMPAIGN = {
    id: '50000000-0000-4000-8000-000000000001',
    label: 'Guest list',
    status: 'ACTIVE',
    expiresAt: '2026-08-04T12:00:00.000Z',
    maxRedemptions: 10,
    redemptionCount: 2,
    disabledAt: null,
    createdAt: '2026-08-02T12:00:00.000Z',
    event: EVENT,
};

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('AdmissionConsole promotion invitations', () => {
    it('renders admission, ticket and invitation controls in Spanish', () => {
        render(
            <AdmissionConsoleImpl
                role="FACILITATOR_OP"
                events={[EVENT]}
                locale="es"
                copy={messages.es.ops.admissionPanel}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Buscar entrada' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Email, últimos cuatro/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Emitir entradas' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Invitaciones controladas' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cargar invitaciones' })).toBeInTheDocument();
    });

    it('shows promotional provenance in the ordinary entitlement lookup', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                results: [{
                    id: '70000000-0000-4000-8000-000000000001',
                    state: 'BOUND',
                    tier: 'COMP',
                    codeLastFour: '7XQP',
                    boundEmail: 'guest@example.invalid',
                    expiresAt: '2026-08-09T14:30:00.000Z',
                    revokedAt: null,
                    revocationReason: null,
                    event: EVENT,
                    commerce: null,
                    promotion: {
                        campaignId: CAMPAIGN.id,
                        label: CAMPAIGN.label,
                        status: CAMPAIGN.status,
                        expiresAt: CAMPAIGN.expiresAt,
                        redeemedAt: '2026-08-02T12:00:00.000Z',
                    },
                }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<AdmissionConsole role="OPERATOR" events={[EVENT]} />);

        await userEvent.type(
            screen.getByPlaceholderText(/Attendee email/),
            'guest@example.invalid',
        );
        await userEvent.click(screen.getByRole('button', { name: 'Look up' }));

        expect(await screen.findByText(/Invitation:/)).toBeInTheDocument();
        expect(screen.getByText(/Guest list · campaign Active/)).toBeInTheDocument();
    });

    it('shows the global kill switch and clears the raw code after bounded creation', async () => {
        const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
            ok: true,
            status: init?.method === 'POST' ? 201 : 200,
            json: async () => init?.method === 'POST'
                ? { redemptionEnabled: false, campaign: CAMPAIGN }
                : { redemptionEnabled: false, campaigns: [] },
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(<AdmissionConsole role="FACILITATOR_OP" events={[EVENT]} />);

        await userEvent.click(screen.getByRole('button', { name: 'Load invitations' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Public redemption is OFF');

        await userEvent.type(screen.getByLabelText(/Internal label/), 'Guest list');
        const code = screen.getByLabelText(/Human code/);
        await userEvent.type(code, 'nico100');
        await userEvent.type(screen.getByLabelText(/Expires/), '2026-08-04T09:00');
        await userEvent.clear(screen.getByLabelText(/Redemption capacity/));
        await userEvent.type(screen.getByLabelText(/Redemption capacity/), '10');
        await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

        await waitFor(() => expect(screen.getByText('Guest list')).toBeInTheDocument());
        expect(code).toHaveValue('');
        const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
        expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
            sessionId: EVENT.id,
            code: 'nico100',
            label: 'Guest list',
            maxRedemptions: 10,
        });
        expect(document.body.textContent).not.toContain('nico100');
    });

    it('makes preservation versus derived revocation an explicit staff choice', async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => ({
            ok: true,
            status: 200,
            json: async () => init?.method === 'POST'
                ? {
                    id: CAMPAIGN.id,
                    status: 'DISABLED',
                    revokeDerived: true,
                    revokedEntitlements: 2,
                    mediaCleanupFailed: false,
                }
                : { redemptionEnabled: true, campaigns: [CAMPAIGN] },
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(<AdmissionConsole role="OPERATOR" events={[EVENT]} />);

        await userEvent.click(screen.getByRole('button', { name: 'Load invitations' }));
        expect(await screen.findByText('Guest list')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Public redemption is ON');

        await userEvent.type(screen.getByPlaceholderText(/Disable reason/), 'Guest list withdrawn');
        await userEvent.click(screen.getByRole('checkbox', { name: /Also revoke every entitlement/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Disable invitation' }));

        await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Retry revoke / disconnect' })).toBeEnabled();
        const disableCall = fetchMock.mock.calls.find(([url, init]) =>
            String(url).includes(`/api/ops/invitations/${CAMPAIGN.id}`) && init?.method === 'POST',
        );
        expect(JSON.parse(String(disableCall?.[1]?.body))).toEqual({
            action: 'disable',
            reason: 'Guest list withdrawn',
            revokeDerived: true,
        });
    });
});
