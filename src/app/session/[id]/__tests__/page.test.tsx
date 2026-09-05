// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { LocaleProvider } from '@/context/LocaleContext';
import type { UiLocale } from '@/lib/i18n';

// TRUST_AND_SAFETY §4 item 5: a participant must be told a session ended,
// not just dropped. These tests exercise the RoomEvent.Disconnected handler
// in src/app/session/[id]/page.tsx and the three copy variants it renders.

const mockPush = vi.fn();
const navigationMocks = vi.hoisted(() => ({ surface: null as string | null }));
const audioMocks = vi.hoisted(() => ({
    setBeaconVolume: vi.fn(),
    startBeaconAudio: vi.fn().mockResolvedValue(true),
}));
const liveKitBehavior = vi.hoisted(() => ({ connectFailuresRemaining: 0 }));
vi.mock('next/navigation', () => ({
    useParams: () => ({ id: 'session-1' }),
    useSearchParams: () => ({
        get: (key: string) => key === 'surface' ? navigationMocks.surface : null,
    }),
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
        private cameraFacingMode: 'user' | 'environment' = 'user';
        remoteParticipants = new Map<string, unknown>();
        activeSpeakers: unknown[] = [];
        state = 'connected';
        cameraTrack = {
            restartTrack: vi.fn().mockImplementation(async (options?: { facingMode?: 'user' | 'environment' }) => {
                if (options?.facingMode) this.cameraFacingMode = options.facingMode;
            }),
            mediaStreamTrack: {
                getSettings: () => ({ facingMode: this.cameraFacingMode }),
            },
        };
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
            publishData: vi.fn().mockResolvedValue(undefined),
            setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
            setCameraEnabled: vi.fn().mockResolvedValue(undefined),
            getTrackPublication: vi.fn((source: string) => (
                source === 'camera' && this.localParticipant.isCameraEnabled
                    ? { videoTrack: this.cameraTrack }
                    : undefined
            )),
            enableCameraAndMicrophone: vi.fn().mockImplementation(async () => {
                this.localParticipant.isCameraEnabled = true;
                this.localParticipant.isMicrophoneEnabled = true;
                return [];
            }),
        };
        connect = vi.fn().mockImplementation(async () => {
            if (liveKitBehavior.connectFailuresRemaining > 0) {
                liveKitBehavior.connectFailuresRemaining -= 1;
                throw new Error('simulated transport failure');
            }
        });
        disconnect = vi.fn();
        startAudio = vi.fn().mockResolvedValue(undefined);
        on(event: string, cb: (...args: unknown[]) => void) {
            (this.listeners[event] ||= []).push(cb);
            return this;
        }
        off(event: string, cb: (...args: unknown[]) => void) {
            this.listeners[event] = (this.listeners[event] || []).filter((listener) => listener !== cb);
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
            DataReceived: 'dataReceived',
            Disconnected: 'disconnected',
        },
        Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { Camera: 'camera', Microphone: 'microphone' } },
        AudioPresets: {
            musicHighQuality: { maxBitrate: 96_000 },
        },
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
import { Room, DisconnectReason, type RoomOptions } from 'livekit-client';

interface EmittableRoom {
    emit: (event: string, ...args: unknown[]) => void;
    disconnect: ReturnType<typeof vi.fn>;
    startAudio: ReturnType<typeof vi.fn>;
    cameraTrack: {
        restartTrack: ReturnType<typeof vi.fn>;
        mediaStreamTrack: { getSettings: () => { facingMode: string } };
    };
    localParticipant: {
        permissions: { canPublish: boolean };
        isCameraEnabled: boolean;
        isMicrophoneEnabled: boolean;
        setMicrophoneEnabled: ReturnType<typeof vi.fn>;
        setCameraEnabled: ReturnType<typeof vi.fn>;
        getTrackPublication: ReturnType<typeof vi.fn>;
        enableCameraAndMicrophone: ReturnType<typeof vi.fn>;
    };
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
    identity: 'opaque-attendee-12345678',
    displayName: 'Nico',
    role: 'ATTENDEE',
    principalKind: 'ticket',
};

const ENTRY_RESPONSE = {
    state: 'READY',
    identity: { kind: 'attendee', displayName: 'Nico', confirmed: true },
    session: {
        id: 'session-1',
        title: 'Test Session',
        language: 'ENGLISH',
        scheduledAt: '2026-08-01T18:00:00.000Z',
        status: 'LIVE',
    },
};

beforeEach(() => {
    navigationMocks.surface = null;
    liveKitBehavior.connectFailuresRemaining = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.cookie = 'hb_locale=; Path=/; Max-Age=0';
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    audioMocks.setBeaconVolume.mockClear();
    audioMocks.startBeaconAudio.mockClear();
    audioMocks.startBeaconAudio.mockResolvedValue(true);
    global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/entry')) {
            return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE });
        }
        if (url.includes('/token')) {
            return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    mockPush.mockClear();
    vi.restoreAllMocks();
});

async function renderConnected() {
    renderPage('en');
    await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());
}

function renderPage(locale: UiLocale = 'en') {
    return render(
        <LocaleProvider initialLocale={locale}>
            <SessionRoomPage />
        </LocaleProvider>,
    );
}

describe('SessionRoomPage - event entry', () => {
    it('keeps backend details private and explains an entry check failure in the selected language', async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: 'database connection refused at internal-host:5432' }),
        } as Response);

        renderPage('es');

        expect(await screen.findByText('No se pudo comprobar el ingreso')).toBeInTheDocument();
        expect(screen.queryByText(/internal-host/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument();
    });

    it('shows a truthful waiting room and mints no LiveKit token before doors open', async () => {
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        state: 'WAITING',
                        identity: ENTRY_RESPONSE.identity,
                        session: {
                            ...ENTRY_RESPONSE.session,
                            language: 'SPANISH',
                            status: 'SCHEDULED',
                        },
                    }),
                } as Response);
            }
            throw new Error(`Unexpected request: ${String(url)}`);
        });

        renderPage();

        expect(await screen.findByText('Entrada confirmada')).toBeInTheDocument();
        expect(screen.getByText('Test Session')).toBeInTheDocument();
        expect(screen.getByText(/automáticamente cuando el equipo las abra/)).toBeInTheDocument();
        expect(Room).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/token'));
    });

    it('preserves an explicit English preference for a Spanish event, including long waiting copy', async () => {
        document.cookie = 'hb_locale=en; Path=/';
        window.localStorage.setItem('hb-locale', 'en');
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                state: 'WAITING',
                identity: ENTRY_RESPONSE.identity,
                session: {
                    ...ENTRY_RESPONSE.session,
                    language: 'SPANISH',
                    status: 'SCHEDULED',
                },
            }),
        } as Response);

        renderPage('en');

        expect(await screen.findByText('Ticket confirmed')).toBeInTheDocument();
        expect(screen.getByText(
            'The doors are not open yet. This page will bring you in automatically when the team opens them.',
        )).toBeInTheDocument();
        expect(document.documentElement.lang).toBe('en');
    });

    it('renders the designed closing state without mounting LiveKit', async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                state: 'ENDED',
                identity: ENTRY_RESPONSE.identity,
                session: { ...ENTRY_RESPONSE.session, status: 'ENDED' },
            }),
        } as Response);

        renderPage();

        expect(await screen.findByText('Session ended')).toBeInTheDocument();
        expect(screen.getByText('Thank you for being part of it.')).toBeInTheDocument();
        expect(Room).not.toHaveBeenCalled();
    });

    it('enters automatically when a status refresh observes open doors', async () => {
        let entryChecks = 0;
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                entryChecks += 1;
                return Promise.resolve({
                    ok: true,
                    json: async () => entryChecks === 1
                        ? {
                            state: 'WAITING',
                            identity: ENTRY_RESPONSE.identity,
                            session: { ...ENTRY_RESPONSE.session, status: 'SCHEDULED' },
                        }
                        : ENTRY_RESPONSE,
                } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });

        renderPage();
        expect(await screen.findByText('Ticket confirmed')).toBeInTheDocument();

        fireEvent.focus(window);

        await waitFor(() => expect(Room).toHaveBeenCalledOnce());
        expect(await screen.findByTestId('viewer-identity')).toBeInTheDocument();
    });

    it('disconnects the media room and shows closing copy when staff ends the event', async () => {
        let entryChecks = 0;
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                entryChecks += 1;
                return Promise.resolve({
                    ok: true,
                    json: async () => entryChecks === 1
                        ? ENTRY_RESPONSE
                        : {
                            state: 'ENDED',
                            identity: ENTRY_RESPONSE.identity,
                            session: { ...ENTRY_RESPONSE.session, status: 'ENDED' },
                        },
                } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });

        renderPage();
        await screen.findByText('Test Session');
        const connectedRoom = currentRoom();

        fireEvent.focus(window);

        expect(await screen.findByText('Session ended')).toBeInTheDocument();
        await waitFor(() => expect(connectedRoom.disconnect).toHaveBeenCalledOnce());
    });

    it('does not mint a LiveKit token until the attendee confirms their visible name', async () => {
        const roomsBefore = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const unconfirmed = {
            ...ENTRY_RESPONSE,
            identity: { kind: 'attendee', displayName: 'Participante', confirmed: false },
        };
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
            if (String(url).includes('/entry') && init?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ displayName: 'Anahí 李', confirmed: true }),
                } as Response);
            }
            if (String(url).includes('/entry')) {
                return Promise.resolve({ ok: true, json: async () => unconfirmed } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ ...TOKEN_RESPONSE, displayName: 'Anahí 李' }),
                } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });

        renderPage('es');

        const input = await screen.findByRole('textbox', { name: /Tu nombre visible|Your visible name/i });
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomsBefore);
        expect(vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(0);
        fireEvent.change(input, { target: { value: 'Anahí 李' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar y continuar|Confirm and continue/i }));

        await waitFor(() => expect(
            (Room as unknown as { mock: { calls: unknown[] } }).mock.calls,
        ).toHaveLength(roomsBefore + 1));
        expect(await screen.findByTestId('viewer-identity')).toHaveTextContent('Anahí 李');
    });

    it('ignores an entry poll that started before the attendee confirmed their name', async () => {
        const roomsBefore = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const unconfirmed = {
            ...ENTRY_RESPONSE,
            identity: { kind: 'attendee', displayName: 'Participante', confirmed: false },
        };
        let entryGets = 0;
        let releaseStalePoll: (value: typeof unconfirmed) => void = () => {};
        const stalePoll = new Promise<typeof unconfirmed>((resolve) => {
            releaseStalePoll = resolve;
        });
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
            if (String(url).includes('/entry') && init?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ displayName: 'Anahí 李', confirmed: true }),
                } as Response);
            }
            if (String(url).includes('/entry')) {
                entryGets += 1;
                return Promise.resolve({
                    ok: true,
                    json: async () => entryGets === 1 ? unconfirmed : stalePoll,
                } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ ...TOKEN_RESPONSE, displayName: 'Anahí 李' }),
                } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });

        renderPage('es');
        const input = await screen.findByRole('textbox', { name: /Tu nombre visible|Your visible name/i });
        fireEvent.focus(window);
        await waitFor(() => expect(entryGets).toBe(2));

        fireEvent.change(input, { target: { value: 'Anahí 李' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmar y continuar|Confirm and continue/i }));
        await waitFor(() => expect(
            (Room as unknown as { mock: { calls: unknown[] } }).mock.calls,
        ).toHaveLength(roomsBefore + 1));
        const connectedRoom = currentRoom();

        await act(async () => {
            releaseStalePoll(unconfirmed);
            await stalePoll;
        });

        expect(screen.queryByRole('textbox', { name: /Tu nombre visible|Your visible name/i })).toBeNull();
        expect(await screen.findByTestId('viewer-identity')).toHaveTextContent('Anahí 李');
        expect(connectedRoom.disconnect).not.toHaveBeenCalled();
    });
});

describe('SessionRoomPage - participant identity', () => {
    it('shows the server-authorized attendee name without exposing role, opaque identity, or diagnostics', async () => {
        await renderConnected();

        expect(screen.getByTestId('viewer-identity')).toHaveTextContent(
            'Signed in as: Nico',
        );
        expect(screen.getByTestId('viewer-identity')).not.toHaveTextContent(/ATTENDEE|12345678|ID/);
        expect(screen.getByTestId('viewer-role-guidance')).toHaveTextContent(
            /your camera and microphone stay under your control/i,
        );
        expect(screen.queryByText(/Beacon room:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Audio A/B check')).not.toBeInTheDocument();
        expect(document.querySelector('audio[src*="/api/audio-diagnostic"]')).toBeNull();
    });

    it('changes visible language without reconnecting either media room', async () => {
        await renderConnected();
        const connectedRoom = currentRoom();
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'hb-locale',
                newValue: 'es',
            }));
        });

        expect(await screen.findByRole('button', { name: 'Iniciar audio' })).toBeInTheDocument();
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
        expect(connectedRoom.disconnect).not.toHaveBeenCalled();
    });
});

describe('SessionRoomPage - staff cockpit handoff', () => {
    function installStaffToken(isAssignedFacilitator = true) {
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        ...TOKEN_RESPONSE,
                        canPublish: isAssignedFacilitator,
                        principalKind: 'staff',
                        role: 'FACILITATOR_OP',
                        isAssignedFacilitator,
                    }),
                } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });
    }

    it('localizes the composite role and explains its event-scoped facilitator authority', async () => {
        installStaffToken(true);
        await renderConnected();

        expect(screen.getByTestId('viewer-identity')).toHaveTextContent(
            'Nico · Facilitator and operations',
        );
        expect(screen.getByTestId('viewer-identity')).not.toHaveTextContent('FACILITATOR_OP');
        expect(screen.getByTestId('viewer-role-guidance')).toHaveTextContent(
            /Assigned facilitator.*camera and microphone remain under your control/i,
        );
        const options = vi.mocked(Room).mock.calls.at(-1)?.[0] as RoomOptions;
        expect(options).toMatchObject({
            audioCaptureDefaults: {
                sampleRate: { ideal: 48_000 },
                channelCount: { ideal: 1 },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                voiceIsolation: false,
            },
            publishDefaults: {
                audioPreset: { maxBitrate: 96_000, priority: 'high' },
                dtx: false,
                red: true,
                forceStereo: false,
            },
        });
        expect(screen.getByTestId('facilitator-audio-quality')).toBeInTheDocument();
    });

    it('explains that unassigned composite staff has operational access without publication', async () => {
        installStaffToken(false);
        await renderConnected();

        expect(screen.getByTestId('viewer-role-guidance')).toHaveTextContent(
            /Operational access.*do not publish as its assigned facilitator/i,
        );
        const options = vi.mocked(Room).mock.calls.at(-1)?.[0] as RoomOptions;
        expect(options.audioCaptureDefaults).toBeUndefined();
        expect(options.publishDefaults?.audioPreset).toBeUndefined();
    });

    it('disconnects the standalone room and preserves device intent before opening the cockpit', async () => {
        installStaffToken();
        await renderConnected();
        const room = currentRoom();
        room.localParticipant.permissions.canPublish = true;
        act(() => room.emit('participantPermissionsChanged', null, room.localParticipant));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument());
        room.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async (enabled: boolean) => {
            room.localParticipant.isMicrophoneEnabled = enabled;
        });
        let releaseCamera: (() => void) | undefined;
        room.localParticipant.setCameraEnabled.mockImplementationOnce(async (enabled: boolean) => {
            await new Promise<void>((resolve) => { releaseCamera = resolve; });
            room.localParticipant.isCameraEnabled = enabled;
        });

        fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
        fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stage and hands' }));

        expect(room.disconnect).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
        await waitFor(() => expect(releaseCamera).toBeTypeOf('function'));
        releaseCamera?.();

        await waitFor(() => expect(room.disconnect).toHaveBeenCalledOnce());
        expect(mockPush).toHaveBeenCalledWith('/ops/events/session-1');
        expect(JSON.parse(window.sessionStorage.getItem('hb-stage-handoff:session-1') ?? '{}'))
            .toEqual(expect.objectContaining({ camera: true, microphone: true, audioOnly: false }));
    });

    it('consumes a fresh handoff and restores both devices inside the persistent cockpit room', async () => {
        installStaffToken();
        navigationMocks.surface = 'cockpit';
        window.sessionStorage.setItem('hb-stage-handoff:session-1', JSON.stringify({
            camera: true,
            microphone: true,
            audioOnly: true,
            createdAt: Date.now(),
        }));

        await renderConnected();

        expect(currentRoom().localParticipant.enableCameraAndMicrophone).toHaveBeenCalledOnce();
        expect(window.sessionStorage.getItem('hb-stage-handoff:session-1')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stage and hands' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn video back on' })).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('SessionRoomPage - stage invitation consent', () => {
    function installGrantedHand() {
        let canPublish = true;
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
            const target = String(url);
            if (target.includes('/entry')) {
                return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE } as Response);
            }
            if (target.includes('/token')) {
                return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE } as Response);
            }
            if (target.includes('/hand')) {
                if (init?.method === 'PATCH') {
                    canPublish = false;
                    // Mirror the LiveKit permission update completed by the
                    // decline endpoint. Leaving the SDK mock grant at `true`
                    // lets a queued stage refresh resurrect the invitation.
                    currentRoom().localParticipant.permissions.canPublish = false;
                }
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        participantId: 'participant-1',
                        raised: false,
                        raisedAt: null,
                        queuePosition: null,
                        canPublish,
                    }),
                } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });
    }

    async function receiveInvitation() {
        installGrantedHand();
        await renderConnected();
        const room = currentRoom();
        room.localParticipant.permissions.canPublish = true;
        act(() => {
            room.emit('participantPermissionsChanged', null, room.localParticipant);
        });
        return {
            room,
            dialog: await screen.findByRole('dialog', { name: 'You’re invited into the scene' }),
        };
    }

    it('requests no device and exposes no stage controls before the attendee accepts', async () => {
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const { room, dialog } = await receiveInvitation();

        await waitFor(() => {
            expect(dialog).toHaveFocus();
        });
        expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
        expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Turn camera on' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unmute microphone' })).not.toBeInTheDocument();
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount + 1);
        expect(room.disconnect).not.toHaveBeenCalled();
    });

    it('starts camera and microphone only from Accept without recreating the room', async () => {
        const { room } = await receiveInvitation();
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));

        await waitFor(() => {
            expect(room.localParticipant.enableCameraAndMicrophone).toHaveBeenCalledOnce();
        });
        expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
        expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
        expect(await screen.findByRole('button', { name: 'Turn camera off' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeInTheDocument();
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
        expect(room.disconnect).not.toHaveBeenCalled();
    });

    it('switches front and rear cameras in place without touching microphone, Beacon, or Room lifecycle', async () => {
        const { room } = await receiveInvitation();
        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
        await screen.findByRole('button', { name: 'Switch to rear camera' });

        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const microphoneCalls = room.localParticipant.setMicrophoneEnabled.mock.calls.length;
        const combinedDeviceCalls = room.localParticipant.enableCameraAndMicrophone.mock.calls.length;
        const beaconStartCalls = audioMocks.startBeaconAudio.mock.calls.length;
        const beaconVolumeCalls = audioMocks.setBeaconVolume.mock.calls.length;
        const stageAudioStartCalls = room.startAudio.mock.calls.length;
        const cameraToggleCalls = room.localParticipant.setCameraEnabled.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Switch to rear camera' }));

        await waitFor(() => expect(room.cameraTrack.restartTrack).toHaveBeenCalledWith({
            facingMode: 'environment',
        }));
        expect(await screen.findByText('Rear camera')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Switch to front camera' })).toBeInTheDocument();
        expect(room.localParticipant.isMicrophoneEnabled).toBe(true);
        expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(microphoneCalls);
        expect(room.localParticipant.enableCameraAndMicrophone).toHaveBeenCalledTimes(combinedDeviceCalls);
        expect(audioMocks.startBeaconAudio).toHaveBeenCalledTimes(beaconStartCalls);
        expect(audioMocks.setBeaconVolume).toHaveBeenCalledTimes(beaconVolumeCalls);
        expect(room.startAudio).toHaveBeenCalledTimes(stageAudioStartCalls);
        expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(cameraToggleCalls);
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
        expect(room.disconnect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Switch to front camera' }));
        await waitFor(() => expect(room.cameraTrack.restartTrack).toHaveBeenLastCalledWith({
            facingMode: 'user',
        }));
        expect(await screen.findByText('Front camera')).toBeInTheDocument();
    });

    it('keeps the attendee on stage and explains when only the camera fails', async () => {
        const { room } = await receiveInvitation();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        room.localParticipant.enableCameraAndMicrophone.mockImplementationOnce(async () => {
            room.localParticipant.isMicrophoneEnabled = true;
            room.localParticipant.isCameraEnabled = false;
            throw new Error('camera permission denied');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));

        expect(await screen.findByText(
            'The microphone is on, but the camera could not start. Check camera permission and try again.',
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeInTheDocument();
    });

    it('keeps recovery controls visible and explains when both devices fail', async () => {
        const { room } = await receiveInvitation();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        room.localParticipant.enableCameraAndMicrophone.mockRejectedValueOnce(
            new Error('device permissions denied'),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));

        expect(await screen.findByText(
            'You accepted, but the browser could not turn on the camera or microphone. Check both permissions and retry with the controls.',
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeInTheDocument();
    });

    it('declines the invitation durably without touching devices or the room lifecycle', async () => {
        const { room } = await receiveInvitation();
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/scheduled-sessions/session-1/hand',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ action: 'decline_invitation' }),
            }),
        );
        expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
        expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
        expect(room.disconnect).not.toHaveBeenCalled();
    });

    it('leaves the stage deliberately and keeps both receiving rooms mounted', async () => {
        const { room } = await receiveInvitation();
        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
        await screen.findByRole('button', { name: 'Leave the scene' });
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const beaconStarts = audioMocks.startBeaconAudio.mock.calls.length;
        const stageAudioStarts = room.startAudio.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Leave the scene' }));
        const confirmation = await screen.findByRole('alertdialog', { name: 'Return to the audience?' });
        expect(confirmation).toHaveTextContent(/keep hearing the session and Beacon without reconnecting/i);
        expect(screen.getByRole('button', { name: 'Stay on stage' })).toHaveFocus();
        expect(room.disconnect).not.toHaveBeenCalled();

        const confirm = screen.getByRole('button', { name: 'Yes, leave the scene' });
        fireEvent.click(confirm);
        fireEvent.click(confirm);

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Leave the scene' })).not.toBeInTheDocument());
        const leaveRequests = vi.mocked(global.fetch).mock.calls.filter(([, init]) =>
            init?.method === 'PATCH' && init.body === JSON.stringify({ action: 'leave_stage' }));
        expect(leaveRequests).toHaveLength(1);
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
        expect(room.disconnect).not.toHaveBeenCalled();
        expect(audioMocks.startBeaconAudio).toHaveBeenCalledTimes(beaconStarts);
        expect(room.startAudio).toHaveBeenCalledTimes(stageAudioStarts);
        expect(screen.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected');
    });

    it('stays on stage with retryable feedback when the voluntary exit request fails', async () => {
        const { room } = await receiveInvitation();
        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
        await screen.findByRole('button', { name: 'Leave the scene' });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const fetchMock = vi.mocked(global.fetch);
        const fallback = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, init) => {
            if (
                String(url).includes('/hand') &&
                init?.method === 'PATCH' &&
                init.body === JSON.stringify({ action: 'leave_stage' })
            ) {
                return Promise.resolve({
                    ok: false,
                    status: 503,
                    json: async () => ({ error: 'stage_unavailable' }),
                } as Response);
            }
            return fallback!(url, init);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Leave the scene' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, leave the scene' }));

        expect(await screen.findByText(/could not complete your return/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Yes, leave the scene' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Turn camera off' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeInTheDocument();
        expect(room.disconnect).not.toHaveBeenCalled();
        expect(screen.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected');
    });
});

describe('SessionRoomPage - deliberate session exit', () => {
    it('separates session exit from everyday controls and disconnects only after confirmation', async () => {
        await renderConnected();
        const room = currentRoom();

        fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
        const confirmation = screen.getByRole('alertdialog', { name: 'Leave session' });
        expect(confirmation).toHaveTextContent(/disconnects this page from the session and Beacon/i);
        expect(room.disconnect).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Stay in the session' })).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Stay in the session' }));
        expect(room.disconnect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, leave the session' }));

        expect(room.disconnect).toHaveBeenCalledOnce();
        expect(mockPush).toHaveBeenCalledWith('/');
    });
});

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
    it('reconnects automatically with a fresh token before ejecting the attendee', async () => {
        await renderConnected();
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.SIGNAL_CLOSE);
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByTestId('connection-state')).toHaveTextContent('Reconnecting');

        await waitFor(
            () => expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount + 1),
            { timeout: 2_000 },
        );
        expect(await screen.findByText('Test Session')).toBeInTheDocument();
        expect(screen.getByTestId('connection-state')).toHaveTextContent('Connected');
        expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
    });

    it('restores accepted camera and microphone state after transport recovery', async () => {
        const { room } = await (async () => {
            const canPublish = true;
            vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
                const target = String(url);
                if (target.includes('/entry')) {
                    return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE } as Response);
                }
                if (target.includes('/token')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ ...TOKEN_RESPONSE, canPublish }),
                    } as Response);
                }
                if (target.includes('/hand')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ canPublish }),
                    } as Response);
                }
                return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
            });
            await renderConnected();
            const invitedRoom = currentRoom();
            invitedRoom.localParticipant.permissions.canPublish = canPublish;
            act(() => invitedRoom.emit('participantPermissionsChanged', null, invitedRoom.localParticipant));
            await screen.findByRole('dialog', { name: 'You’re invited into the scene' });
            return { room: invitedRoom };
        })();

        fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
        await waitFor(() => expect(room.localParticipant.enableCameraAndMicrophone).toHaveBeenCalledOnce());

        act(() => {
            room.emit('disconnected', DisconnectReason.CONNECTION_TIMEOUT);
        });

        await waitFor(
            () => expect(currentRoom()).not.toBe(room),
            { timeout: 2_000 },
        );
        await waitFor(() => {
            expect(currentRoom().localParticipant.enableCameraAndMicrophone).toHaveBeenCalledOnce();
        });
    });

    it('stops after three failed automatic attempts and offers a manual rejoin', async () => {
        await renderConnected();
        liveKitBehavior.connectFailuresRemaining = 3;
        vi.useFakeTimers();

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.MEDIA_FAILURE);
        });
        for (const delay of [500, 1_500, 3_000]) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(delay);
                await Promise.resolve();
            });
        }

        const status = screen.getByRole('status');
        expect(within(status).getByText('Connection lost')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rejoin' })).toBeInTheDocument();
    });
});

describe('SessionRoomPage - duplicate identity disconnect', () => {
    it('explains the conflicting access and waits for an explicit rejoin', async () => {
        await renderConnected();
        const roomCount = (Room as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

        act(() => {
            currentRoom().emit('disconnected', DisconnectReason.DUPLICATE_IDENTITY);
        });

        const status = await screen.findByRole('status');
        expect(within(status).getByText('This access is open elsewhere')).toBeInTheDocument();
        expect(within(status).getByText(
            'The same access was opened in another tab or device. Close it there, then rejoin here.',
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rejoin' })).toBeInTheDocument();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 650));
        });
        expect((Room as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(roomCount);
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

    it('announces the full terminal lifecycle in Spanish when the event seeded a first visit', async () => {
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        ...ENTRY_RESPONSE,
                        session: { ...ENTRY_RESPONSE.session, language: 'SPANISH' },
                    }),
                } as Response);
            }
            if (String(url).includes('/token')) {
                return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        });

        renderPage('en');
        await screen.findByText('Test Session');
        act(() => currentRoom().emit('disconnected', undefined));

        const status = await screen.findByRole('status');
        expect(within(status).getByText('Desconectado')).toBeInTheDocument();
        expect(within(status).getByText(
            'Ya no estás conectado a esta sesión. No podemos saber si terminó o si se cortó tu conexión.',
        )).toBeInTheDocument();
        expect(document.documentElement.lang).toBe('es');
    });
});

describe('SessionRoomPage - intentional disconnects are not terminal states', () => {
    it('does not show a terminal view when the participant chose to leave', async () => {
        await renderConnected();

        fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, leave the session' }));
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

        fireEvent.click(screen.getByRole('button', { name: 'Start audio' }));

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
        let tokenAttempts = 0;
        vi.mocked(global.fetch).mockImplementation((url: string | URL | Request) => {
            if (String(url).includes('/entry')) {
                return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE } as Response);
            }
            if (String(url).includes('/token') && tokenAttempts++ === 0) {
                return Promise.resolve({
                    ok: false,
                    json: async () => ({ error: 'Room is temporarily unavailable' }),
                } as Response);
            }
            return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE } as Response);
        });

        renderPage();
        expect(await screen.findByText('We could not enter the room. Your access is still confirmed; try again.')).toBeInTheDocument();
        expect(screen.queryByText('Room is temporarily unavailable')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(screen.getByText('Connecting')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());
    });
});
