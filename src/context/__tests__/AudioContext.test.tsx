// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roomMocks = vi.hoisted(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    startAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('livekit-client', () => ({
    Room: vi.fn().mockImplementation(function RoomMock() {
        return {
            connect: roomMocks.connect,
            disconnect: roomMocks.disconnect,
            startAudio: roomMocks.startAudio,
            on: vi.fn().mockReturnThis(),
        };
    }),
    RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
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
