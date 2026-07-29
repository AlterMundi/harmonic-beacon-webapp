import { vi } from 'vitest';

/**
 * A hand-built stand-in for the parts of `livekit-client` the session room
 * touches. Shared because both the room page and any future stage surface need
 * the same shape, and because a per-file fake drifts from the SDK independently.
 *
 * It is an event emitter plus plain participant records: `emit` is the test's
 * hook for simulating anything the server pushes (a promotion, a mute, a quality
 * drop, a disconnect).
 */

export interface FakeVideoTrack {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
}

export interface FakeVideoPublication {
    kind: 'video';
    trackSid: string;
    videoTrack: FakeVideoTrack | null;
    setSubscribed: ReturnType<typeof vi.fn>;
    setVideoDimensions: ReturnType<typeof vi.fn>;
}

export interface FakeParticipant {
    identity: string;
    name: string;
    isSpeaking: boolean;
    connectionQuality: string;
    permissions?: { canPublish: boolean };
    trackPublications: Map<string, FakeVideoPublication>;
    videoTrackPublications: Map<string, FakeVideoPublication>;
    isCameraEnabled: boolean;
    isMicrophoneEnabled: boolean;
    setCameraEnabled: ReturnType<typeof vi.fn>;
    setMicrophoneEnabled: ReturnType<typeof vi.fn>;
}

export interface FakeParticipantOptions {
    identity: string;
    /** Non-PII role word, matching `RoomPrincipal.displayName`. */
    name?: string;
    canPublish?: boolean;
    camera?: boolean;
    mic?: boolean;
    speaking?: boolean;
    quality?: string;
    /** Force a video publication even for a non-publisher. */
    withVideoPublication?: boolean;
}

export function createFakeVideoPublication(trackSid: string): FakeVideoPublication {
    return {
        kind: 'video',
        trackSid,
        videoTrack: { attach: vi.fn(), detach: vi.fn() },
        setSubscribed: vi.fn(),
        setVideoDimensions: vi.fn(),
    };
}

export function createFakeParticipant(options: FakeParticipantOptions): FakeParticipant {
    const canPublish = options.canPublish ?? false;
    const publications = new Map<string, FakeVideoPublication>();
    if (canPublish || options.withVideoPublication) {
        publications.set(
            `${options.identity}-video`,
            createFakeVideoPublication(`${options.identity}-video`),
        );
    }

    const participant: FakeParticipant = {
        identity: options.identity,
        name: options.name ?? 'Attendee',
        isSpeaking: options.speaking ?? false,
        connectionQuality: options.quality ?? 'excellent',
        permissions: { canPublish },
        trackPublications: publications,
        videoTrackPublications: publications,
        isCameraEnabled: canPublish ? options.camera ?? true : false,
        isMicrophoneEnabled: canPublish ? options.mic ?? true : false,
        setCameraEnabled: vi.fn(),
        setMicrophoneEnabled: vi.fn(),
    };

    // Mirror the SDK: enabling a device flips the getter the UI reads back.
    participant.setCameraEnabled.mockImplementation(async (enabled: boolean) => {
        participant.isCameraEnabled = enabled;
    });
    participant.setMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
        participant.isMicrophoneEnabled = enabled;
    });

    return participant;
}

export class FakeRoom {
    private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    state = 'connecting';
    activeSpeakers: FakeParticipant[] = [];
    remoteParticipants = new Map<string, FakeParticipant>();
    localParticipant = createFakeParticipant({ identity: 'local', name: 'Attendee' });

    connect = vi.fn().mockImplementation(async () => {
        this.state = 'connected';
    });
    disconnect = vi.fn();

    on(event: string, cb: (...args: unknown[]) => void) {
        (this.listeners[event] ||= []).push(cb);
        return this;
    }

    emit(event: string, ...args: unknown[]) {
        (this.listeners[event] || []).forEach((cb) => cb(...args));
    }

    /** Add a remote participant as the server would, and announce it. */
    addParticipant(options: FakeParticipantOptions): FakeParticipant {
        const participant = createFakeParticipant(options);
        this.remoteParticipants.set(participant.identity, participant);
        this.emit('participantConnected', participant);
        return participant;
    }
}

type MockedRoomConstructor = { mock: { results: Array<{ value: FakeRoom }> } };

/** The most recently constructed FakeRoom, i.e. the one the page is using. */
export function latestFakeRoom(RoomCtor: unknown): FakeRoom {
    const { results } = (RoomCtor as MockedRoomConstructor).mock;
    return results[results.length - 1].value;
}

function fakePreset(width: number, height: number, maxBitrate: number) {
    return {
        width,
        height,
        resolution: { width, height, frameRate: 30 },
        encoding: { maxBitrate, maxFramerate: 30 },
    };
}

/**
 * Module factory for `vi.mock('livekit-client', ...)`. Only values the room page
 * imports at runtime are present; anything missing should fail loudly rather
 * than be quietly undefined.
 */
export function livekitClientMock() {
    return {
        Room: vi.fn().mockImplementation(function RoomCtor() {
            return new FakeRoom();
        }),
        RoomEvent: {
            Reconnecting: 'reconnecting',
            Reconnected: 'reconnected',
            Disconnected: 'disconnected',
            ConnectionStateChanged: 'connectionStateChanged',
            ParticipantConnected: 'participantConnected',
            ParticipantDisconnected: 'participantDisconnected',
            TrackPublished: 'trackPublished',
            TrackUnpublished: 'trackUnpublished',
            TrackSubscribed: 'trackSubscribed',
            TrackUnsubscribed: 'trackUnsubscribed',
            TrackMuted: 'trackMuted',
            TrackUnmuted: 'trackUnmuted',
            TrackSubscriptionStatusChanged: 'trackSubscriptionStatusChanged',
            LocalTrackPublished: 'localTrackPublished',
            LocalTrackUnpublished: 'localTrackUnpublished',
            ActiveSpeakersChanged: 'activeSpeakersChanged',
            ConnectionQualityChanged: 'connectionQualityChanged',
            ParticipantPermissionsChanged: 'participantPermissionsChanged',
        },
        Track: { Kind: { Audio: 'audio', Video: 'video' } },
        VideoPresets: {
            h180: fakePreset(320, 180, 150_000),
            h360: fakePreset(640, 360, 500_000),
            h720: fakePreset(1280, 720, 1_700_000),
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
    };
}
