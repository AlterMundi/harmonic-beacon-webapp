// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roomMocks = vi.hoisted(() => ({
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
    Room: vi.fn().mockImplementation(function RoomMock() {
        return {
            connect: roomMocks.connect,
            disconnect: roomMocks.disconnect,
            remoteParticipants: roomMocks.remoteParticipants,
            startAudio: roomMocks.startAudio,
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                roomMocks.handlers.set(event, handler);
                return undefined;
            }),
        };
    }),
    RoomEvent: {
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
        roomMocks.handlers.clear();
        roomMocks.remoteParticipants.clear();
        roomMocks.connect.mockClear().mockResolvedValue(undefined);
        roomMocks.disconnect.mockClear();
        roomMocks.startAudio.mockClear().mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ token: 'bed-token' }),
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('unlocks the LiveKit audio graph from an explicit user action', async () => {
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
        const audio = document.createElement('audio');
        const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
        const attachedElements: HTMLMediaElement[] = [];
        const track = {
            kind: 'audio',
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
        const publication = { track, isSubscribed: true };
        const participant = {
            identity: 'playlist-bot',
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
                json: async () => ({ token: 'obsolete-token' }),
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
            // Mirrors LiveKit startAudio(), which unmutes attached tracks.
            playlistAudio.muted = false;
            liveAudio.muted = false;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));

        await screen.findByText('playing');
        expect(playlistAudio.muted).toBe(true);
        expect(liveAudio.muted).toBe(false);
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
