// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpotlightConsole from '../SpotlightConsole';

type Participant = Record<string, unknown>;

function attendee(id: string, overrides: Partial<Participant> = {}): Participant {
    return {
        id,
        identity: `opaque-${id}`,
        displayName: 'Attendee',
        principalType: 'attendee',
        staffRole: null,
        joinedAt: '2026-08-01T15:00:00.000Z',
        leftAt: null,
        raisedAt: null,
        queuePosition: null,
        canPublish: false,
        grantVersion: 0,
        reconcileNeeded: false,
        connected: true,
        media: [],
        connectionQuality: null,
        ...overrides,
    };
}

function snapshot(participants: Participant[], overrides: Record<string, unknown> = {}) {
    return {
        sessionId: 'event-1',
        maxPublishers: 6,
        activePublishers: 2,
        liveStateAvailable: true,
        participants,
        ...overrides,
    };
}

const stagePosts: Array<Record<string, unknown>> = [];

function mockFetch(participantsPayload: unknown, stageResponder?: (body: Record<string, unknown>) => { status: number; data: Record<string, unknown> }) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            stagePosts.push(body);
            const result = stageResponder
                ? stageResponder(body)
                : { status: 200, data: { ok: true } };
            return {
                ok: result.status < 400,
                status: result.status,
                json: async () => result.data,
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => participantsPayload,
        };
    });
}

describe('SpotlightConsole', () => {
    beforeEach(() => {
        stagePosts.length = 0;
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders the queue in raisedAt order with stage and audience sections', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('on-stage', {
                canPublish: true,
                connectionQuality: 'GOOD',
                media: [{ trackSid: 'TR_audio', source: 'MICROPHONE', muted: true }],
            }),
            attendee('second', {
                raisedAt: '2026-08-01T15:11:00.000Z',
                queuePosition: 2,
            }),
            attendee('first', {
                raisedAt: '2026-08-01T15:10:00.000Z',
                queuePosition: 1,
                connectionQuality: 'POOR',
            }),
            attendee('gone', { connected: false }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await waitFor(() => {
            expect(screen.getByText('#1 — Attendee · ID ue-first')).toBeInTheDocument();
        });
        const queueItems = screen.getAllByText(/^#\d — Attendee · ID /);
        expect(queueItems.map((item) => item.textContent)).toEqual([
            '#1 — Attendee · ID ue-first',
            '#2 — Attendee · ID e-second',
        ]);
        expect(screen.getByText('On stage')).toBeInTheDocument();
        expect(screen.getByText(/microphone muted/)).toBeInTheDocument();
        expect(screen.getByText(/left/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Take floor' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Give floor' })).toHaveLength(2);
    });

    it('does not offer the floor to a stale disconnected hand', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('stale', {
                raisedAt: '2026-08-01T15:10:00.000Z',
                queuePosition: 1,
                connected: false,
            }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="FACILITATOR" />);

        const reconnect = await screen.findByRole('button', { name: 'Waiting for reconnect' });
        expect(reconnect).toBeDisabled();
        await userEvent.click(reconnect);
        expect(stagePosts).toHaveLength(0);
    });

    it('invites a connected audience member directly to the stage', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([attendee('audience')])));
        render(<SpotlightConsole sessionId="event-1" role="FACILITATOR" />);

        await userEvent.click(await screen.findByRole('button', { name: 'Invite to stage' }));

        await waitFor(() => {
            expect(stagePosts).toContainEqual({
                action: 'promote',
                participantId: 'audience',
                reason: 'Invited from audience',
            });
        });
    });

    it('gives the floor by promoting through stage control, then clears the hand', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('first', {
                raisedAt: '2026-08-01T15:10:00.000Z',
                queuePosition: 1,
            }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="FACILITATOR" />);

        await waitFor(() => screen.getByRole('button', { name: 'Give floor' }));
        await userEvent.click(screen.getByRole('button', { name: 'Give floor' }));

        await waitFor(() => {
            expect(stagePosts).toEqual([
                { action: 'promote', participantId: 'first', reason: 'Hand queue' },
                { action: 'lower_hand', participantId: 'first', reason: 'Promoted to stage' },
            ]);
        });
    });

    it('explains stage_full with the queue position and keeps the hand raised', async () => {
        vi.stubGlobal('fetch', mockFetch(
            snapshot([
                attendee('first', {
                    raisedAt: '2026-08-01T15:10:00.000Z',
                    queuePosition: 1,
                }),
            ]),
            () => ({
                status: 409,
                data: { error: 'stage_full', message: 'The stage is full', queuePosition: 3 },
            }),
        ));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await waitFor(() => screen.getByRole('button', { name: 'Give floor' }));
        await userEvent.click(screen.getByRole('button', { name: 'Give floor' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Stage is full — this hand stays #3 in the queue',
            );
        });
        // No lower_hand call: the hand was not served.
        expect(stagePosts).toHaveLength(1);
    });

    it('points the operator at Reconcile after a LiveKit failure', async () => {
        vi.stubGlobal('fetch', mockFetch(
            snapshot([
                attendee('first', {
                    raisedAt: '2026-08-01T15:10:00.000Z',
                    queuePosition: 1,
                }),
            ]),
            () => ({
                status: 502,
                data: { error: 'livekit_failed', message: 'LiveKit promotion failed', reconcileNeeded: true },
            }),
        ));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await waitFor(() => screen.getByRole('button', { name: 'Give floor' }));
        await userEvent.click(screen.getByRole('button', { name: 'Give floor' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'LiveKit promotion failed. The durable grant was revoked; press Reconcile to retry',
            );
        });
    });

    it('reports a disconnected promotion without asking for reconciliation', async () => {
        vi.stubGlobal('fetch', mockFetch(
            snapshot([attendee('first', {
                raisedAt: '2026-08-01T15:10:00.000Z',
                queuePosition: 1,
            })]),
            () => ({
                status: 409,
                data: {
                    error: 'participant_not_connected',
                    message: 'This participant is not connected. Wait for them to rejoin before giving the floor.',
                },
            }),
        ));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await userEvent.click(await screen.findByRole('button', { name: 'Give floor' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('This participant is not connected');
            expect(screen.getByRole('alert')).not.toHaveTextContent('Reconcile');
        });
    });

    it('runs reconciliation from the banner control', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('drifted', { canPublish: true, reconcileNeeded: true }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="ADMIN" />);

        await waitFor(() => {
            expect(screen.getByText(/need.? reconciliation/i)).toBeInTheDocument();
        });
        await userEvent.click(screen.getByRole('button', { name: 'Reconcile grants' }));

        await waitFor(() => {
            expect(stagePosts).toContainEqual({ action: 'reconcile' });
        });
    });

    it('warns when live state is unavailable instead of showing everyone as left', async () => {
        vi.stubGlobal('fetch', mockFetch(
            snapshot([attendee('only')], { liveStateAvailable: false }),
        ));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await waitFor(() => {
            expect(screen.getByText(/LiveKit live state unavailable/)).toBeInTheDocument();
        });
    });

    it('mutes a publisher track through the stage endpoint', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('on-stage', {
                canPublish: true,
                media: [{ trackSid: 'TR_audio', source: 'MICROPHONE', muted: false }],
            }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        await waitFor(() => screen.getByRole('button', { name: 'Mute microphone' }));
        await userEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));

        await waitFor(() => {
            expect(stagePosts).toContainEqual({
                action: 'mute',
                participantId: 'on-stage',
                trackSid: 'TR_audio',
                muted: true,
            });
        });
    });

    it('does not offer remote unmute for participant media', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('on-stage', {
                canPublish: true,
                media: [{ trackSid: 'TR_video', source: 'CAMERA', muted: true }],
            }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        expect(await screen.findByText('Participant must re-enable camera')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Unmute camera/i })).not.toBeInTheDocument();
    });

    it('marks the facilitator slot as reserved instead of offering demotion', async () => {
        vi.stubGlobal('fetch', mockFetch(snapshot([
            attendee('facilitator', {
                displayName: 'Julián',
                principalType: 'staff',
                staffRole: 'FACILITATOR',
                canPublish: true,
            }),
        ])));
        render(<SpotlightConsole sessionId="event-1" role="OPERATOR" />);

        expect(await screen.findByText('Reserved facilitator slot')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Take floor' })).not.toBeInTheDocument();
    });
});
