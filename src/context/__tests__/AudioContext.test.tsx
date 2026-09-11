// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomOptions } from 'livekit-client';

const roomMocks = vi.hoisted(() => ({
    state: 'connected',
    canPlaybackAudio: false,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    startAudio: vi.fn().mockResolvedValue(undefined),
    handlers: new Map<string, (...args: unknown[]) => void>(),
    remoteParticipants: new Map<string, {
        trackPublications: Map<string, {
            track: { attachedElements: HTMLMediaElement[] };
        }>;
    }>(),
}));

vi.mock('livekit-client', () => ({
    Room: vi.fn().mockImplementation(function RoomMock(options: RoomOptions = {}) {
        return {
            options: { ...options, webAudioMix: options.webAudioMix ?? false },
            get canPlaybackAudio() { return roomMocks.canPlaybackAudio; },
            get state() { return roomMocks.state; },
            connect: roomMocks.connect,
            disconnect: roomMocks.disconnect,
            remoteParticipants: roomMocks.remoteParticipants,
            startAudio: roomMocks.startAudio,
            off: vi.fn(),
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                roomMocks.handlers.set(event, handler);
                return undefined;
            }),
        };
    }),
    RoomEvent: {
        AudioPlaybackStatusChanged: 'audioPlaybackStatusChanged',
        Reconnected: 'reconnected',
        ConnectionStateChanged: 'connectionStateChanged',
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        TrackMuted: 'trackMuted',
        TrackUnmuted: 'trackUnmuted',
        Disconnected: 'disconnected',
    },
    Track: { Kind: { Audio: 'audio' } },
}));

vi.mock('@/lib/redact', () => ({
    redactErrorDetail: (error: unknown) => String(error),
}));

import { AudioProvider, useAudio } from '../AudioContext';
import { Room } from 'livekit-client';

function AudioControl() {
    const { audioError, isConnected, isPlaying, startAudio } = useAudio();
    return (
        <>
            <p>{isConnected ? 'connected' : 'connecting'}</p>
            <p>{isPlaying ? 'playing' : 'stopped'}</p>
            <button onClick={() => void startAudio()}>Start</button>
            {audioError ? <p role="alert">{audioError}</p> : null}
        </>
    );
}

describe('AudioProvider', () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        // jsdom has no media engine; individual blocked-playback tests override this.
        vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
        roomMocks.canPlaybackAudio = false;
        roomMocks.handlers.clear();
        roomMocks.state = 'connected';
        roomMocks.remoteParticipants.clear();
        roomMocks.connect.mockClear().mockResolvedValue(undefined);
        roomMocks.disconnect.mockClear();
        roomMocks.startAudio.mockReset().mockImplementation(async () => { roomMocks.canPlaybackAudio = true; });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ token: 'bed-token', livekitUrl: 'wss://live.example.com' }),
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('keeps Beacon on cancellable unload, retires once on pagehide and rebuilds after bfcache', async () => {
        const view = render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        expect(vi.mocked(Room).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ disconnectOnPageLeave: false }));
        fireEvent(window, new Event('beforeunload', { cancelable: true }));
        expect(roomMocks.disconnect).not.toHaveBeenCalled();
        fireEvent(window, new PageTransitionEvent('pagehide', { persisted: true }));
        expect(roomMocks.disconnect).toHaveBeenCalledOnce();
        expect(screen.queryByText('connected')).toBeNull();
        fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
        await waitFor(() => expect(roomMocks.connect).toHaveBeenCalledTimes(2));
        expect(roomMocks.disconnect).toHaveBeenCalledOnce();
        view.unmount();
        expect(roomMocks.disconnect).toHaveBeenCalledTimes(2);
    });

    it('clears native readiness at committed retirement and ignores pending activation after bfcache restore', async () => {
        roomMocks.canPlaybackAudio = true;
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        expect(screen.getByText('playing')).toBeInTheDocument();
        let reject!: (reason: Error) => void;
        roomMocks.startAudio.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        fireEvent(window, new PageTransitionEvent('pagehide', { persisted: true }));
        expect(screen.getByText('stopped')).toBeInTheDocument();
        expect(roomMocks.disconnect).toHaveBeenCalledOnce();
        fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
        await waitFor(() => expect(roomMocks.connect).toHaveBeenCalledTimes(2));
        await screen.findByText('playing');
        await act(async () => { reject(new Error('retired activation')); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('playing')).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reflects playback enabled by entry or device gestures without requiring another click', async () => {
        roomMocks.canPlaybackAudio = true;
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        expect(screen.getByText('playing')).toBeInTheDocument();
        expect(roomMocks.startAudio).not.toHaveBeenCalled();

        act(() => {
            roomMocks.canPlaybackAudio = false;
            roomMocks.handlers.get('audioPlaybackStatusChanged')?.(false);
        });
        expect(screen.getByText('stopped')).toBeInTheDocument();
        act(() => {
            roomMocks.canPlaybackAudio = true;
            roomMocks.handlers.get('audioPlaybackStatusChanged')?.(true);
        });
        expect(screen.getByText('playing')).toBeInTheDocument();
    });

    it('keeps blocked native playback retryable even when the SDK reports enabled', async () => {
        roomMocks.canPlaybackAudio = true;
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const audio = document.createElement('audio');
        let paused = true;
        vi.spyOn(audio, 'paused', 'get').mockImplementation(() => paused);
        const play = vi.spyOn(audio, 'play').mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
        const track = { kind: 'audio', attach: () => audio, detach: () => [audio] };
        await act(async () => {
            roomMocks.handlers.get('trackSubscribed')?.(track, {}, { identity: 'playlist-bot' });
        });
        expect(screen.getByText('stopped')).toBeInTheDocument();
        play.mockImplementation(async () => { paused = false; audio.dispatchEvent(new Event('playing')); });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await screen.findByText('playing');
        expect(screen.queryByRole('alert')).toBeNull();
        act(() => { paused = true; audio.dispatchEvent(new Event('pause')); });
        expect(screen.getByText('stopped')).toBeInTheDocument();
        act(() => { paused = false; audio.dispatchEvent(new Event('playing')); });
        expect(screen.getByText('playing')).toBeInTheDocument();
        expect(document.body.querySelectorAll('audio')).toHaveLength(1);
    });

    it('starts a late native source when SDK readiness changes before React effects flush', async () => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const audio = document.createElement('audio');
        let paused = true;
        vi.spyOn(audio, 'paused', 'get').mockImplementation(() => paused);
        const play = vi.spyOn(audio, 'play').mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
        const track = { kind: 'audio', attach: () => audio, detach: () => [audio] };
        await act(async () => {
            roomMocks.canPlaybackAudio = true;
            roomMocks.handlers.get('audioPlaybackStatusChanged')?.(true);
            roomMocks.handlers.get('trackSubscribed')?.(track, {}, { identity: 'playlist-bot' });
        });
        // The autoplay rejection must be consumed here, not on the retry. A
        // mockImplementation() does not clear an unconsumed mockRejectedValueOnce.
        expect(play).toHaveBeenCalledOnce();
        expect(screen.getByText('stopped')).toBeInTheDocument();
        play.mockImplementation(async () => { paused = false; audio.dispatchEvent(new Event('playing')); });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await screen.findByText('playing');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('ignores pending activation failure from an obsolete provider room', async () => {
        const view = render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        let reject!: (reason: Error) => void;
        roomMocks.startAudio.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        roomMocks.canPlaybackAudio = true;
        view.rerender(<AudioProvider sessionId="session-2"><AudioControl /></AudioProvider>);
        await screen.findByText('playing');
        await act(async () => { reject(new Error('obsolete')); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('playing')).toBeInTheDocument();
    });

    it('ignores a late native rejection from an obsolete room', async () => {
        roomMocks.canPlaybackAudio = true;
        const view = render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const audio = document.createElement('audio');
        let reject!: (reason: Error) => void;
        vi.spyOn(audio, 'play').mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
        const oldTrack = { kind: 'audio', attach: () => audio, detach: () => [audio] };
        act(() => { roomMocks.handlers.get('trackSubscribed')?.(oldTrack, {}, { identity: 'playlist-bot' }); });
        view.rerender(<AudioProvider sessionId="session-2"><AudioControl /></AudioProvider>);
        await screen.findByText('playing');
        await act(async () => { reject(new Error('obsolete native')); });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('playing')).toBeInTheDocument();
    });

    it('coalesces activation until every source settles before allowing a retry', async () => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const audio = document.createElement('audio');
        vi.spyOn(audio, 'play').mockRejectedValue(new Error('blocked native'));
        vi.spyOn(audio, 'paused', 'get').mockReturnValue(true);
        const track = { kind: 'audio', attach: () => audio, detach: () => [audio] };
        act(() => { roomMocks.handlers.get('trackSubscribed')?.(track, {}, { identity: 'playlist-bot' }); });
        let resolve!: () => void;
        roomMocks.startAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await act(async () => {});
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(roomMocks.startAudio).toHaveBeenCalledOnce();
        await act(async () => { resolve(); });
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await waitFor(() => expect(roomMocks.startAudio).toHaveBeenCalledTimes(2));
    });

    it('does not race the SDK transport recovery with another connect request', async () => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        act(() => {
            roomMocks.state = 'reconnecting';
            roomMocks.handlers.get('connectionStateChanged')?.('reconnecting');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await act(async () => {});
        expect(fetch).toHaveBeenCalledOnce();
        expect(roomMocks.connect).toHaveBeenCalledOnce();
        expect(screen.getByText('stopped')).toBeInTheDocument();
        act(() => {
            roomMocks.state = 'connected';
            roomMocks.handlers.get('reconnected')?.();
        });
        expect(screen.getByText('playing')).toBeInTheDocument();
    });

    it.each(['token', 'connect'])('retries a failed initial %s connection with a fresh token', async (failure) => {
        if (failure === 'token') {
            vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
        } else {
            roomMocks.connect.mockRejectedValueOnce(new Error('offline'));
        }
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        expect(await screen.findByRole('alert')).toHaveTextContent('could not connect');
        expect(screen.getByText('connecting')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await screen.findByText('connected');
        await screen.findByText('playing');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['beacon01', 'playlist-bot'])('preserves intentional %s mute and zero gain through SDK activation', async (identity) => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const audio = document.createElement('audio');
        const track = { kind: 'audio', attach: () => audio, detach: () => [audio] };
        act(() => { roomMocks.handlers.get('trackSubscribed')?.(track, {}, { identity }); });
        audio.muted = true;
        audio.volume = 0;
        roomMocks.startAudio.mockImplementationOnce(async () => {
            audio.muted = false;
            roomMocks.canPlaybackAudio = true;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(audio.muted).toBe(true);
        await screen.findByText('playing');
        expect(audio.volume).toBe(0);
    });

    it('does not report activation success from a resolved promise when playback is still blocked', async () => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        roomMocks.startAudio.mockImplementationOnce(async () => { roomMocks.canPlaybackAudio = false; });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await screen.findByRole('alert');
        expect(screen.getByText('stopped')).toBeInTheDocument();
    });

    it('requests LiveKit playback from an explicit user action', async () => {
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await waitFor(() => expect(roomMocks.connect).toHaveBeenCalledOnce());

        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        await waitFor(() => {
            expect(roomMocks.startAudio).toHaveBeenCalledOnce();
            expect(screen.getByText('playing')).toBeInTheDocument();
        });
    });

    it('keeps a track that arrived before the click attached exactly once', async () => {
        vi.stubEnv('NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER', '1');
        const continuityTrackSubscribed = vi.fn(() => { throw new Error('observer failure'); });
        Object.assign(window, { continuityTrackSubscribed });
        const audio = document.createElement('audio');
        // This case needs activation: native success now correctly overrides a
        // stale SDK false flag, so model actual paused output before the click.
        let paused = true;
        vi.spyOn(audio, 'paused', 'get').mockImplementation(() => paused);
        const play = vi.spyOn(audio, 'play').mockImplementation(async () => { paused = false; });
        const attachedElements: HTMLMediaElement[] = [];
        const track = {
            kind: 'audio',
            mediaStreamTrack: {} as MediaStreamTrack,
            attachedElements,
            attach: vi.fn(() => {
                if (!attachedElements.includes(audio)) attachedElements.push(audio);
                return audio;
            }),
            detach: vi.fn(() => {
                attachedElements.length = 0;
                // Mirrors the real unsubscribe path observed in LiveKit: the
                // SDK has already cleared srcObject and returns no DOM nodes.
                return [];
            }),
        };
        const publication = { track, isSubscribed: true, trackSid: 'TR_playlist' };
        const participant = {
            identity: 'playlist-bot',
            sid: 'PA_playlist',
            trackPublications: new Map([['playlist', publication]]),
        };
        roomMocks.remoteParticipants.set(participant.identity, participant);

        const { unmount } = render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        roomMocks.handlers.get('trackSubscribed')?.(track, publication, participant);
        expect(continuityTrackSubscribed).toHaveBeenCalledWith(track.mediaStreamTrack, participant.sid, publication.trackSid);
        expect(track.attach).toHaveBeenCalledOnce();
        expect(document.body.querySelectorAll('audio')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        await waitFor(() => expect(play).toHaveBeenCalledOnce());
        expect(track.detach).not.toHaveBeenCalled();
        expect(document.body.querySelectorAll('audio')).toHaveLength(1);

        roomMocks.handlers.get('trackUnsubscribed')?.(track, publication, participant);
        expect(track.detach).toHaveBeenCalledOnce();
        expect(audio.isConnected).toBe(false);

        unmount();
        expect(audio.isConnected).toBe(false);
    });

    it('buffers playlist music before attaching it without delaying live beacon audio', async () => {
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        const playlistAudio = document.createElement('audio');
        const playlistReceiver = { jitterBufferTarget: null as number | null };
        const playlistTrack = {
            kind: 'audio',
            receiver: playlistReceiver,
            attach: vi.fn(() => {
                expect(playlistReceiver.jitterBufferTarget).toBe(500);
                return playlistAudio;
            }),
            detach: vi.fn(() => [playlistAudio]),
        };
        roomMocks.handlers.get('trackSubscribed')?.(
            playlistTrack,
            { track: playlistTrack, isSubscribed: true },
            { identity: 'playlist-bot', trackPublications: new Map() },
        );

        const liveAudio = document.createElement('audio');
        const liveReceiver = { jitterBufferTarget: null as number | null };
        const liveTrack = {
            kind: 'audio',
            receiver: liveReceiver,
            attach: vi.fn(() => liveAudio),
            detach: vi.fn(() => [liveAudio]),
        };
        roomMocks.handlers.get('trackSubscribed')?.(
            liveTrack,
            { track: liveTrack, isSubscribed: true },
            { identity: 'beacon01', trackPublications: new Map() },
        );

        expect(playlistReceiver.jitterBufferTarget).toBe(500);
        expect(liveReceiver.jitterBufferTarget).toBeNull();
    });

    it('does not connect an obsolete room after the provider unmounts', async () => {
        let resolveToken!: (response: Response) => void;
        const tokenResponse = new Promise<Response>((resolve) => {
            resolveToken = resolve;
        });
        vi.stubGlobal('fetch', vi.fn(() => tokenResponse));

        const { unmount } = render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        expect(fetch).toHaveBeenCalledOnce();

        unmount();
        await act(async () => {
            resolveToken({
                ok: true,
                json: async () => ({ token: 'obsolete-token', livekitUrl: 'wss://live.example.com' }),
            } as Response);
            await tokenResponse;
        });

        expect(roomMocks.connect).not.toHaveBeenCalled();
        expect(roomMocks.disconnect).toHaveBeenCalledOnce();
    });

    it('removes a track delivered to an obsolete room after unmount', async () => {
        const { unmount } = render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');
        const obsoleteHandler = roomMocks.handlers.get('trackSubscribed');
        unmount();

        const audio = document.createElement('audio');
        document.body.appendChild(audio);
        const track = {
            kind: 'audio',
            attach: vi.fn(() => audio),
            detach: vi.fn(() => [audio]),
        };
        obsoleteHandler?.(
            track,
            { track, isSubscribed: true },
            { identity: 'playlist-bot', trackPublications: new Map() },
        );

        expect(track.attach).not.toHaveBeenCalled();
        expect(track.detach).toHaveBeenCalledOnce();
        expect(audio.isConnected).toBe(false);
    });

    it('starts a track that arrives while the room is still unlocking', async () => {
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        let releaseStart!: () => void;
        const pendingStart = new Promise<void>((resolve) => {
            releaseStart = resolve;
        });
        roomMocks.startAudio.mockReturnValueOnce(pendingStart);
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        const audio = document.createElement('audio');
        const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
        const track = {
            kind: 'audio',
            attach: vi.fn(() => audio),
            detach: vi.fn(() => [audio]),
        };

        roomMocks.handlers.get('trackSubscribed')?.(
            track,
            { track, isSubscribed: true },
            { identity: 'playlist-bot', trackPublications: new Map() },
        );

        await waitFor(() => expect(play).toHaveBeenCalledOnce());
        expect(track.detach).not.toHaveBeenCalled();

        await act(async () => {
            roomMocks.canPlaybackAudio = true;
            releaseStart();
            await pendingStart;
        });
        expect(screen.getByText('playing')).toBeInTheDocument();
    });

    it('replaces a republished source without a duplicate or stale cleanup', async () => {
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        const participant = { identity: 'playlist-bot', trackPublications: new Map() };
        const firstAudio = document.createElement('audio');
        const secondAudio = document.createElement('audio');
        const firstTrack = {
            kind: 'audio',
            attach: vi.fn(() => firstAudio),
            detach: vi.fn(() => []),
        };
        const secondTrack = {
            kind: 'audio',
            attach: vi.fn(() => secondAudio),
            detach: vi.fn(() => []),
        };
        const firstPublication = { track: firstTrack, isMuted: false };
        const secondPublication = { track: secondTrack, isMuted: false };

        roomMocks.handlers.get('trackSubscribed')?.(firstTrack, firstPublication, participant);
        roomMocks.handlers.get('trackSubscribed')?.(secondTrack, secondPublication, participant);

        expect(firstTrack.detach).toHaveBeenCalledOnce();
        expect(firstAudio.isConnected).toBe(false);
        expect(secondAudio.isConnected).toBe(true);
        expect(document.body.querySelectorAll('audio')).toHaveLength(1);

        roomMocks.handlers.get('trackUnsubscribed')?.(firstTrack, firstPublication, participant);
        expect(secondAudio.isConnected).toBe(true);
        expect(document.body.querySelectorAll('audio')).toHaveLength(1);

        roomMocks.handlers.get('trackUnsubscribed')?.(secondTrack, secondPublication, participant);
        expect(secondAudio.isConnected).toBe(false);
    });

    it('keeps the playlist muted when beacon01 is live after audio unlock', async () => {
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        const playlistAudio = document.createElement('audio');
        const liveAudio = document.createElement('audio');
        vi.spyOn(playlistAudio, 'play').mockResolvedValue(undefined);
        vi.spyOn(liveAudio, 'play').mockResolvedValue(undefined);
        const playlistTrack = {
            kind: 'audio',
            attach: vi.fn(() => playlistAudio),
            detach: vi.fn(() => [playlistAudio]),
        };
        const liveTrack = {
            kind: 'audio',
            attach: vi.fn(() => liveAudio),
            detach: vi.fn(() => [liveAudio]),
        };

        const playlistPublication = { track: playlistTrack, isSubscribed: true, isMuted: false };
        const livePublication = { track: liveTrack, isSubscribed: true, isMuted: false };
        const playlistParticipant = { identity: 'playlist-bot', trackPublications: new Map() };
        const liveParticipant = { identity: 'beacon01', trackPublications: new Map() };
        roomMocks.handlers.get('trackSubscribed')?.(
            playlistTrack,
            playlistPublication,
            playlistParticipant,
        );
        roomMocks.handlers.get('trackSubscribed')?.(
            liveTrack,
            livePublication,
            liveParticipant,
        );
        await waitFor(() => expect(playlistAudio.muted).toBe(true));

        livePublication.isMuted = true;
        roomMocks.handlers.get('trackMuted')?.(livePublication, liveParticipant);
        expect(playlistAudio.muted).toBe(false);

        livePublication.isMuted = false;
        roomMocks.handlers.get('trackUnmuted')?.(livePublication, liveParticipant);
        expect(playlistAudio.muted).toBe(true);

        roomMocks.startAudio.mockImplementationOnce(async () => {
            roomMocks.canPlaybackAudio = true;
            // Mirrors LiveKit startAudio(), which unmutes attached tracks.
            playlistAudio.muted = false;
            liveAudio.muted = false;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        await screen.findByText('playing');
        expect(playlistAudio.muted).toBe(true);
        expect(liveAudio.muted).toBe(false);
    });

    it('preserves live priority during a pending or failed unlock, not only after success', async () => {
        render(<AudioProvider sessionId="session-1"><AudioControl /></AudioProvider>);
        await screen.findByText('connected');
        const playlist = document.createElement('audio');
        const live = document.createElement('audio');
        for (const [identity, audio] of [['playlist-bot', playlist], ['beacon01', live]] as const) {
            const track = { kind: 'audio', attach: () => audio, detach: () => [audio] };
            act(() => { roomMocks.handlers.get('trackSubscribed')?.(track, {}, { identity }); });
        }
        let reject!: (error: Error) => void;
        roomMocks.startAudio.mockImplementationOnce(() => {
            playlist.muted = false;
            live.muted = false;
            return new Promise<void>((_resolve, fail) => { reject = fail; });
        });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(playlist.muted).toBe(true);
        await act(async () => { reject(new Error('blocked')); });
        expect(playlist.muted).toBe(true);
        expect(live.muted).toBe(false);
        expect(playlist.volume).toBe(0.5);
        expect(document.body.querySelectorAll('audio')).toHaveLength(2);
    });

    it('keeps the control retryable and gives actionable copy when audio is blocked', async () => {
        roomMocks.startAudio.mockRejectedValueOnce(new Error('NotAllowedError'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <AudioProvider sessionId="session-1">
                <AudioControl />
            </AudioProvider>,
        );
        await screen.findByText('connected');

        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Check that this tab is not muted',
        );
        expect(screen.getByText('stopped')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    });
});
