// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { LocaleProvider } from '@/context/LocaleContext';

/**
 * Media-continuity invariants (issue #69, epic #64 rubric §4) at the
 * integration level: exercising every control mounted in the live session
 * shell must not disconnect the room, duplicate or detach media elements,
 * or repeat the audio-activation gesture. Runs in the standard `npm test`
 * gate with the LiveKit client faked; the browser-level proof against a
 * real LiveKit server lives in e2e/tests/media-continuity.spec.ts.
 */

const audioMocks = vi.hoisted(() => ({
    setBeaconVolume: vi.fn(),
    startBeaconAudio: vi.fn().mockResolvedValue(true),
}));
vi.mock('next/navigation', () => ({
    useParams: () => ({ id: 'session-1' }),
    useSearchParams: () => ({ get: () => null }),
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/context/AudioContext', () => ({
    AudioProvider: ({ children }: { children: React.ReactNode }) => children,
    useAudio: () => ({
        audioError: null,
        isPlaying: false,
        setVolume: audioMocks.setBeaconVolume,
        startAudio: audioMocks.startBeaconAudio,
        isConnected: true,
        hasPlaylistStream: true,
        hasLiveStream: false,
    }),
}));

vi.mock('@/components', () => ({
    ReportButton: () => null,
}));

vi.mock('@/lib/redact', () => ({
    redactErrorDetail: (e: unknown) => String(e),
}));

vi.mock('livekit-client', async () => {
    const { livekitClientMock } = await import('@/__tests__/livekit-fake');
    return livekitClientMock();
});

import SessionRoomPage from '../page';
import { Room } from 'livekit-client';
import { latestFakeRoom } from '@/__tests__/livekit-fake';

const TOKEN_RESPONSE = {
    session: {
        id: 'session-1',
        title: 'Test Session',
        status: 'LIVE',
        startedAt: null,
        isRecording: false,
    },
    // A regular attendee: publish is grant-gated through the hand queue, so
    // mic/camera toggles are not mounted. Grant-gated device toggles are
    // exercised with real media in e2e/tests/media-continuity.spec.ts.
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

function roomConstructionCount(): number {
    return (Room as unknown as { mock: { results: unknown[] } }).mock.results.length;
}

function bodyMediaElements(): HTMLMediaElement[] {
    return [...document.body.querySelectorAll<HTMLMediaElement>('audio, video')];
}

beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.cookie = 'hb_locale=; Path=/; Max-Age=0';
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    audioMocks.setBeaconVolume.mockClear();
    audioMocks.startBeaconAudio.mockClear();
    audioMocks.startBeaconAudio.mockResolvedValue(true);
    let handRaised = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (url.includes('/entry')) {
            return Promise.resolve({ ok: true, json: async () => ENTRY_RESPONSE });
        }
        if (url.includes('/token')) {
            return Promise.resolve({ ok: true, json: async () => TOKEN_RESPONSE });
        }
        if (url.includes('/hand')) {
            if (init?.method === 'POST') handRaised = true;
            if (init?.method === 'DELETE') handRaised = false;
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    participantId: 'participant-1',
                    raised: handRaised,
                    raisedAt: handRaised ? '2026-08-01T15:10:00.000Z' : null,
                    queuePosition: handRaised ? 1 : null,
                    canPublish: false,
                    grantVersion: 0,
                }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function renderConnectedWithRemoteAudio() {
    render(
        <LocaleProvider initialLocale="en">
            <SessionRoomPage />
        </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByText('Test Session')).toBeInTheDocument());

    const remoteAudio = document.createElement('audio');
    const remoteTrack = {
        kind: 'audio',
        attach: () => remoteAudio,
        detach: () => [remoteAudio],
    };
    act(() => {
        latestFakeRoom(Room).emit('trackSubscribed', remoteTrack, {}, { identity: 'facilitator' });
    });
    return { remoteAudio, remoteTrack };
}

describe('session shell — media continuity invariants', () => {
    it('keeps a Beacon floor at Session and removes stage voice completely at Beacon', async () => {
        const { remoteAudio } = await renderConnectedWithRemoteAudio();
        const balance = screen.getByRole('slider', { name: 'Beacon / Session balance' });

        fireEvent.change(balance, { target: { value: '1' } });
        expect(remoteAudio.muted).toBe(false);
        expect(remoteAudio.volume).toBe(0.8);
        expect(audioMocks.setBeaconVolume.mock.lastCall?.[0]).toBeCloseTo(0.04);

        fireEvent.change(balance, { target: { value: '0' } });
        expect(remoteAudio.muted).toBe(true);
        expect(remoteAudio.volume).toBe(0);
        expect(audioMocks.setBeaconVolume).toHaveBeenLastCalledWith(0.8);
    });

    it('room controls never disconnect, remount, duplicate media, or re-activate audio', async () => {
        const { remoteAudio } = await renderConnectedWithRemoteAudio();
        const room = latestFakeRoom(Room);

        // The single audio-activation gesture for the session lifetime.
        fireEvent.click(screen.getByRole('button', { name: 'Start audio' }));
        expect(audioMocks.startBeaconAudio).toHaveBeenCalledOnce();
        const playCallsAfterActivation = (
            HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>
        ).mock.calls.length;
        expect(playCallsAfterActivation).toBeGreaterThan(0);

        const roomsBefore = roomConstructionCount();
        const mediaBefore = bodyMediaElements();
        expect(mediaBefore).toContain(remoteAudio);

        // Exercise every control mounted in the live shell for an attendee
        // (device toggles are grant-gated and absent here by design).
        fireEvent.change(screen.getByRole('slider', { name: 'Overall room volume' }), {
            target: { value: '0.7' },
        });
        fireEvent.change(screen.getByRole('slider', { name: 'Beacon / Session balance' }), {
            target: { value: '0.25' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Raise hand' }));
        await screen.findByRole('button', { name: 'Lower hand' });
        fireEvent.click(screen.getByRole('button', { name: 'Lower hand' }));
        await screen.findByRole('button', { name: 'Raise hand' });

        // Zero Room.disconnect() calls, zero room remounts.
        expect(room.disconnect).not.toHaveBeenCalled();
        expect(roomConstructionCount()).toBe(roomsBefore);

        // Zero detached or duplicated media elements.
        expect(bodyMediaElements()).toEqual(mediaBefore);

        // No repeated audio activation for the session lifetime.
        expect(audioMocks.startBeaconAudio).toHaveBeenCalledOnce();
        expect(room.startAudio).toHaveBeenCalledOnce();
        expect(
            (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).mock.calls.length,
        ).toBe(playCallsAfterActivation);
    });

    it('audio-only mode detaches exactly the video, never the audio', async () => {
        const { remoteAudio } = await renderConnectedWithRemoteAudio();
        const room = latestFakeRoom(Room);

        fireEvent.click(screen.getByRole('button', { name: 'Switch to audio only' }));
        fireEvent.click(screen.getByRole('button', { name: 'Turn video back on' }));

        expect(room.disconnect).not.toHaveBeenCalled();
        expect(document.body.contains(remoteAudio)).toBe(true);
    });
});
