// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';

// TRUST_AND_SAFETY §4 item 5: a participant must be told a session ended,
// not just dropped. These tests exercise the RoomEvent.Disconnected handler
// in src/app/session/[id]/page.tsx and the three copy variants it renders.

const mockPush = vi.fn();
const audioMocks = vi.hoisted(() => ({
    setBeaconVolume: vi.fn(),
    startBeaconAudio: vi.fn().mockResolvedValue(true),
}));
vi.mock('next/navigation', () => ({
    useParams: () => ({ id: 'session-1' }),
    useSearchParams: () => ({ get: () => null }),
    useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/context/AudioContext', () => ({
    AudioProvider: ({ children }: { children: React.ReactNode }) => children,
    useAudio: () => ({
        audioError: null,
        isPlaying: false,
        setVolume: audioMocks.setBeaconVolume,
        startAudio: audioMocks.startBeaconAudio,
    }),
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
        activeSpeakers: unknown[] = [];
        state = 'connected';
        localParticipant = {
            identity: 'local-participant',
            name: 'Participant',
            permissions: { canPublish: false },
            trackPublications: new Map(),
            videoTrackPublications: new Map(),
            isSpeaking: false,
            isCameraEnabled: false,
            isMicrophoneEnabled: false,
            connectionQuality: 'excellent',
            unpublishTrack: vi.fn(),
            setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
            setCameraEnabled: vi.fn().mockResolvedValue(undefined),
        };
        connect = vi.fn().mockResolvedValue(undefined);
        disconnect = vi.fn();
        startAudio = vi.fn().mockResolvedValue(undefined);
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
            TrackPublished: 'trackPublished',
            TrackUnpublished: 'trackUnpublished',
            TrackMuted: 'trackMuted',
            TrackUnmuted: 'trackUnmuted',
            LocalTrackPublished: 'localTrackPublished',
            LocalTrackUnpublished: 'localTrackUnpublished',
            ActiveSpeakersChanged: 'activeSpeakersChanged',
            TrackSubscriptionStatusChanged: 'trackSubscriptionStatusChanged',
            ConnectionStateChanged: 'connectionStateChanged',
            Reconnecting: 'reconnecting',
            Reconnected: 'reconnected',
            ConnectionQualityChanged: 'connectionQualityChanged',
            ParticipantPermissionsChanged: 'participantPermissionsChanged',
            Disconnected: 'disconnected',
        },
        Track: { Kind: { Audio: 'audio', Video: 'video' } },
        VideoPresets: {
            h720: { resolution: { width: 1280, height: 720 }, encoding: {} },
            h360: { resolution: { width: 640, height: 360 }, encoding: {} },
            h180: { resolution: { width: 320, height: 180 }, encoding: {} },
        },
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
    startAudio: ReturnType<typeof vi.fn>;
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
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    audioMocks.setBeaconVolume.mockClear();
    audioMocks.startBeaconAudio.mockClear();
    audioMocks.startBeaconAudio.mockResolvedValue(true);
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
    vi.restoreAllMocks();
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

        fireEvent.click(screen.getByRole('button', { name: /Back to Sessions/i }));
        expect(mockPush).toHaveBeenCalledWith('/');
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
        expect(screen.getByRole('button', { name: /Rejoin/i })).toBeInTheDocument();
    });

    it('reconnects when Rejoin is clicked', async () => {
        await renderConnected();
        const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.CONNECTION_TIMEOUT);
        });
        await screen.findByRole('button', { name: /Rejoin/i });

        fireEvent.click(screen.getByRole('button', { name: /Rejoin/i }));

        // Back to the connecting state immediately, then reconnected.
        expect(screen.getByText('Connecting')).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /Rejoin/i })).toBeInTheDocument();
    });
});

describe('SessionRoomPage - intentional disconnects are not terminal states', () => {
    it('does not show a terminal view when the participant chose to leave', async () => {
        await renderConnected();

        fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));

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
        const sliders = screen.getAllByRole('slider');

        expect(sliders[1]).toHaveValue('0.5');
        await waitFor(() => {
            const initialBedGain = audioMocks.setBeaconVolume.mock.lastCall?.[0];
            expect(initialBedGain).toBeCloseTo(0.4);
        });

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
        expect(stageAudio.volume).toBeCloseTo(0.4);

        fireEvent.change(sliders[1], { target: { value: '0.25' } });

        await waitFor(() => {
            expect(stageAudio.volume).toBeCloseTo(0.2);
            const bedGain = audioMocks.setBeaconVolume.mock.lastCall?.[0];
            expect(bedGain).toBeCloseTo(0.6);
        });
    });

    it('removes its owned stage element when LiveKit detach returns none', async () => {
        await renderConnected();
        const stageAudio = document.createElement('audio');
        const stageTrack = {
            kind: 'audio',
            attach: vi.fn(() => stageAudio),
            detach: vi.fn(() => []),
        };

        act(() => {
            currentRoom().emit('trackSubscribed', stageTrack, {}, { identity: 'facilitator' });
        });
        expect(stageAudio.isConnected).toBe(true);

        act(() => {
            currentRoom().emit('trackUnsubscribed', stageTrack, {}, { identity: 'facilitator' });
        });
        expect(stageTrack.detach).toHaveBeenCalledOnce();
        expect(stageAudio.isConnected).toBe(false);
    });

    it('discards stage audio delivered to a room after page cleanup', async () => {
        await renderConnected();
        const obsoleteRoom = currentRoom();
        cleanup();

        const stageAudio = document.createElement('audio');
        document.body.appendChild(stageAudio);
        const stageTrack = {
            kind: 'audio',
            attach: vi.fn(() => stageAudio),
            detach: vi.fn(() => [stageAudio]),
        };
        act(() => {
            obsoleteRoom.emit('trackSubscribed', stageTrack, {}, { identity: 'facilitator' });
        });

        expect(stageTrack.attach).not.toHaveBeenCalled();
        expect(stageTrack.detach).toHaveBeenCalledOnce();
        expect(stageAudio.isConnected).toBe(false);
    });
});

describe('SessionRoomPage - audio activation', () => {
    it('starts both LiveKit rooms before awaiting either one', async () => {
        await renderConnected();
        const stageAudio = document.createElement('audio');
        const stagePlay = vi.spyOn(stageAudio, 'play').mockResolvedValue(undefined);
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

        let releaseStage!: () => void;
        const stageStart = new Promise<void>((resolve) => {
            releaseStage = resolve;
        });
        currentRoom().startAudio.mockReturnValueOnce(stageStart);
        stagePlay.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Start audio · Iniciar audio' }));

        expect(currentRoom().startAudio).toHaveBeenCalledOnce();
        expect(audioMocks.startBeaconAudio).toHaveBeenCalledOnce();
        expect(stagePlay).toHaveBeenCalledOnce();

        await act(async () => {
            releaseStage();
            await stageStart;
        });
    });
});

describe('SessionRoomPage - initial connection failure', () => {
    it('offers a retry without forcing the attendee back through login', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Room is temporarily unavailable' }),
        });

        render(<SessionRoomPage />);
        expect(await screen.findByText('Room is temporarily unavailable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.getByText('Connecting')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());
    });
});
