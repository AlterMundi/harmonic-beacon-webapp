// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';

// TRUST_AND_SAFETY §4 item 5: a participant must be told a session ended,
// not just dropped. These tests exercise the RoomEvent.Disconnected handler
// in src/app/session/[id]/page.tsx and the three copy variants it renders.

const mockPush = vi.fn();
const mockSetBeaconVolume = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
    useParams: () => ({ id: 'session-1' }),
    useSearchParams: () => ({ get: () => null }),
    useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/context/AudioContext', () => ({
    AudioProvider: ({ children }: { children: React.ReactNode }) => children,
    useAudio: () => ({ volume: 0.8, setVolume: mockSetBeaconVolume }),
}));

vi.mock('@/components', () => ({
    ReportButton: () => null,
}));

vi.mock('@/lib/redact', () => ({
    redactErrorDetail: (e: unknown) => String(e),
}));

// A minimal fake of the LiveKit client Room: an event emitter with the bits
// of the Room API the page actually touches. `emit` is the test's hook for
// simulating server-pushed events like RoomEvent.Disconnected.
vi.mock('livekit-client', () => {
    class FakeRoom {
        private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        remoteParticipants = new Map<string, unknown>();
        localParticipant = {
            trackPublications: new Map(),
            unpublishTrack: vi.fn(),
            setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
        };
        connect = vi.fn().mockResolvedValue(undefined);
        disconnect = vi.fn();
        on(event: string, cb: (...args: unknown[]) => void) {
            (this.listeners[event] ||= []).push(cb);
            return this;
        }
        emit(event: string, ...args: unknown[]) {
            (this.listeners[event] || []).forEach((cb) => cb(...args));
        }
    }

    return {
        Room: vi.fn().mockImplementation(function RoomCtor() { return new FakeRoom(); }),
        RoomEvent: {
            TrackSubscribed: 'trackSubscribed',
            TrackUnsubscribed: 'trackUnsubscribed',
            ParticipantConnected: 'participantConnected',
            ParticipantDisconnected: 'participantDisconnected',
            Disconnected: 'disconnected',
        },
        Track: { Kind: { Audio: 'audio' } },
        // Mirrors @livekit/protocol's DisconnectReason enum values used by
        // classifyDisconnectReason in the page.
        DisconnectReason: {
            UNKNOWN_REASON: 0,
            CLIENT_INITIATED: 1,
            DUPLICATE_IDENTITY: 2,
            SERVER_SHUTDOWN: 3,
            PARTICIPANT_REMOVED: 4,
            ROOM_DELETED: 5,
            STATE_MISMATCH: 6,
            JOIN_FAILURE: 7,
            MIGRATION: 8,
            SIGNAL_CLOSE: 9,
            ROOM_CLOSED: 10,
            CONNECTION_TIMEOUT: 14,
            MEDIA_FAILURE: 15,
        },
        LocalTrackPublication: class {},
    };
});

import SessionRoomPage from '../page';
import { Room, DisconnectReason } from 'livekit-client';

interface EmittableRoom {
    emit: (event: string, ...args: unknown[]) => void;
    disconnect: ReturnType<typeof vi.fn>;
}

function currentRoom(): EmittableRoom {
    const mocked = Room as unknown as { mock: { results: Array<{ value: EmittableRoom }> } };
    const { results } = mocked.mock;
    return results[results.length - 1].value;
}

const TOKEN_RESPONSE = {
    session: {
        id: 'session-1',
        title: 'Test Session',
        status: 'LIVE',
        startedAt: null,
        isRecording: false,
    },
    canPublish: false,
    token: 'test-token',
};

beforeEach(() => {
    mockSetBeaconVolume.mockClear();
    global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/token')) {
            return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;
});

afterEach(() => {
    cleanup();
    mockPush.mockClear();
});

async function renderConnected() {
    render(<SessionRoomPage />);
    await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());
}

describe('SessionRoomPage - server-ended disconnect', () => {
    it('says the session ended, without a rejoin option, and announces it', async () => {
        await renderConnected();

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.ROOM_DELETED);
        });

        const status = await screen.findByRole('status');
        expect(within(status).getByText('Session ended')).toBeInTheDocument();
        expect(within(status).getByText("This session has ended. You're no longer connected.")).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Rejoin' })).not.toBeInTheDocument();

        // Doesn't speculate about who ended it or why, in either direction.
        expect(screen.queryByText(/moderator/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();

        await waitFor(() => expect(document.activeElement).toBe(status));

        fireEvent.click(screen.getByRole('button', { name: 'Back to Sessions' }));
        expect(mockPush).toHaveBeenCalledWith('/sessions');
    });

    it('treats a participant removal and a server shutdown the same way', async () => {
        for (const reason of [DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_CLOSED, DisconnectReason.SERVER_SHUTDOWN]) {
            cleanup();
            await renderConnected();
            act(() => {
                currentRoom().emit('disconnected', reason);
            });
            expect(await screen.findByText('Session ended')).toBeInTheDocument();
        }
    });
});

describe('SessionRoomPage - transport-failure disconnect', () => {
    it('says the connection dropped and offers a rejoin', async () => {
        await renderConnected();

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.SIGNAL_CLOSE);
        });

        const status = await screen.findByRole('status');
        expect(within(status).getByText('Connection lost')).toBeInTheDocument();
        expect(within(status).getByText('Your connection to this session was lost.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rejoin' })).toBeInTheDocument();
    });

    it('reconnects when Rejoin is clicked', async () => {
        await renderConnected();
        const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.CONNECTION_TIMEOUT);
        });
        await screen.findByRole('button', { name: 'Rejoin' });

        fireEvent.click(screen.getByRole('button', { name: 'Rejoin' }));

        // Back to the connecting state immediately, then reconnected.
        expect(screen.getByText('Connecting to session...')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());
        expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
    });
});

describe('SessionRoomPage - ambiguous disconnect', () => {
    it('says it cannot tell what happened, rather than guessing', async () => {
        await renderConnected();

        act(() => {
            // No reason at all is exactly what a real ambiguous case looks like.
            currentRoom().emit('disconnected', undefined);
        });

        const status = await screen.findByRole('status');
        expect(within(status).getByText('Disconnected')).toBeInTheDocument();
        expect(within(status).getByText(/can't tell whether it ended or your connection dropped/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rejoin' })).toBeInTheDocument();
    });
});

describe('SessionRoomPage - intentional disconnects are not terminal states', () => {
    it('does not show a terminal view when the participant chose to leave', async () => {
        await renderConnected();

        fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sessions'));

        // The real SDK would still fire Disconnected(CLIENT_INITIATED) after
        // our own disconnect() call; it must not produce a terminal screen.
        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.CLIENT_INITIATED);
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText('Session ended')).not.toBeInTheDocument();
        expect(screen.queryByText('Connection lost')).not.toBeInTheDocument();
    });
});

describe('SessionRoomPage - two-room crossfader', () => {
    it('changes stage voice and Beacon bed gains independently', async () => {
        await renderConnected();
        const stageAudio = document.createElement('audio');
        const stageTrack = {
            kind: 'audio',
            attach: () => stageAudio,
            detach: () => [stageAudio],
        };

        act(() => {
            currentRoom().emit(
                'trackSubscribed',
                stageTrack,
                {},
                { identity: 'facilitator' },
            );
        });

        const sliders = screen.getAllByRole('slider');
        fireEvent.change(sliders[1], { target: { value: '0.25' } });

        await waitFor(() => {
            expect(stageAudio.volume).toBeCloseTo(0.2);
            const bedGain = mockSetBeaconVolume.mock.lastCall?.[0];
            expect(bedGain).toBeCloseTo(0.6);
        });
    });
});
