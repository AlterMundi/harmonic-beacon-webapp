// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { ConnectionState, RoomEvent, Room } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import { observeRoomAudioPlayback } from '../room-audio-playback';

function fixture() {
    const room = Object.assign(new EventEmitter(), {
        canPlaybackAudio: true, state: 'connected', options: new Room().options,
    });
    const onChange = vi.fn();
    const playback = observeRoomAudioPlayback(room as unknown as Room, onChange);
    return { room, onChange, playback };
}

describe('room audio playback observation', () => {
    it('gates the native output, not the unused suspended context in a default SDK Room', async () => {
        // Real Room/startAudio/default options; only the unavailable jsdom
        // platform context and media engine are doubled. No private SDK fields.
        const context = Object.assign(new EventTarget(), {
            state: 'suspended', resume: vi.fn(() => new Promise<void>(() => {})),
        });
        vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
        const room = new Room();
        room.state = ConnectionState.Connected; // transport is outside this unit seam
        const onChange = vi.fn();
        const playback = observeRoomAudioPlayback(room, onChange);
        const audio = document.createElement('audio');
        let paused = true;
        const pausedGetter = vi.spyOn(audio, 'paused', 'get').mockImplementation(() => paused);
        playback.add(audio);
        try {
            expect(room.options.webAudioMix).toBe(false);
            await room.startAudio();
            expect(context.resume).toHaveBeenCalled();
            expect(context.state).toBe('suspended');
            expect(room.canPlaybackAudio).toBe(true);
            expect(playback.sync()).toBe(false); // SDK success cannot mask paused output
            paused = false;
            audio.dispatchEvent(new Event('playing'));
            expect(onChange).toHaveBeenLastCalledWith(true);
            expect(context.state).toBe('suspended'); // auxiliary context does not gate it
        } finally {
            playback.dispose();
            context.state = 'closed';
            context.dispatchEvent(new Event('statechange')); // SDK body-listener cleanup
            pausedGetter.mockRestore();
            vi.unstubAllGlobals();
        }
    });
    it('keeps native success when real SDK connect acquisition finishes after gesture-time startAudio', async () => {
        // Real public connect/startAudio paths; only jsdom platform/transport
        // are doubled. Never invoke or read private SDK context fields.
        let finishConnectResume!: () => void;
        let connectResumeStarted!: () => void;
        const acquiring = new Promise<void>((resolve) => { connectResumeStarted = resolve; });
        const context = Object.assign(new EventTarget(), {
            state: 'suspended',
            resume: vi.fn().mockResolvedValueOnce(undefined).mockImplementation(() =>
                new Promise<void>((resolve) => {
                    finishConnectResume = resolve;
                    connectResumeStarted();
                })),
            close: vi.fn().mockResolvedValue(undefined),
        });
        vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
        vi.stubGlobal('RTCPeerConnection', class { addTransceiver() {} });
        vi.stubGlobal('WebSocket', class extends EventTarget {
            static OPEN = 1;
            static CLOSED = 3;
            readyState = 0;
            onclose?: (event: CloseEvent) => void;
            close() {
                this.readyState = 3;
                const event = new CloseEvent('close', { code: 1000 });
                this.onclose?.(event);
                this.dispatchEvent(event);
            }
        });
        const room = new Room();
        const onChange = vi.fn();
        const playback = observeRoomAudioPlayback(room, onChange);
        const audio = document.createElement('audio');
        const paused = vi.spyOn(audio, 'paused', 'get').mockReturnValue(false);
        playback.add(audio);
        let connection: Promise<unknown> | undefined;
        try {
            await room.startAudio(); // initial Beacon retry invokes this before connect
            expect(room.canPlaybackAudio).toBe(true);
            connection = room.connect('ws://localhost:7880', 'fixture-token').catch(() => undefined);
            await acquiring; // microtask ordering, no wall-clock sleep/poll
            expect(context.resume).toHaveBeenCalledTimes(2);
            // Model signaling completion/native attachment before acquisition's
            // delayed completion. Playback flag updates still come from real SDK.
            room.state = ConnectionState.Connected;
            audio.dispatchEvent(new Event('playing'));
            expect(onChange).toHaveBeenLastCalledWith(true);
            const sdkStatus = new Promise<void>((resolve) => {
                room.once(RoomEvent.AudioPlaybackStatusChanged, () => resolve());
            });
            finishConnectResume();
            await sdkStatus;
            expect(context.state).toBe('suspended');
            expect(room.canPlaybackAudio).toBe(false); // exact late SDK overwrite
            expect(audio.paused).toBe(false); // no second playing event to rescue us
            expect(onChange).toHaveBeenLastCalledWith(true);
            paused.mockReturnValue(true);
            audio.dispatchEvent(new Event('pause'));
            expect(onChange).toHaveBeenLastCalledWith(false);
        } finally {
            playback.dispose();
            room.state = ConnectionState.Connecting; // restore doubled transport for abort cleanup
            await room.disconnect();
            await connection;
            context.state = 'closed';
            context.dispatchEvent(new Event('statechange'));
            paused.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it.each([true, { audioContext: { state: 'running' } as AudioContext }])(
        'fails closed for unsupported webAudioMix=%j even with successful native playback',
        (webAudioMix) => {
            const { room, playback, onChange } = fixture();
            // Real SDK resolves public options; never fabricate a native-only
            // default when the caller has actually enabled another output route.
            Object.assign(room, { options: new Room({ webAudioMix }).options });
            const audio = document.createElement('audio');
            vi.spyOn(audio, 'paused', 'get').mockReturnValue(false);
            playback.add(audio);
            expect(playback.sync()).toBe(false);
            expect(onChange).toHaveBeenLastCalledWith(false);
            playback.dispose();
        },
    );

    it('invalidates disconnected playback and resamples it after reconnect', () => {
        const { room, playback, onChange } = fixture();
        expect(playback.sync()).toBe(true);
        room.state = 'reconnecting';
        room.emit(RoomEvent.ConnectionStateChanged, room.state);
        expect(onChange).toHaveBeenLastCalledWith(false);
        room.canPlaybackAudio = false;
        room.state = 'connected';
        room.emit(RoomEvent.Reconnected);
        expect(onChange).toHaveBeenLastCalledWith(false);
        room.canPlaybackAudio = true;
        room.emit(RoomEvent.AudioPlaybackStatusChanged, true);
        expect(onChange).toHaveBeenLastCalledWith(true);
        playback.dispose();
    });

    it.each(['paused', 'ended', 'error'] as const)('does not let one healthy source mask a second source with %s', (fault) => {
        const { room, playback, onChange } = fixture();
        room.canPlaybackAudio = false;
        expect(playback.sync()).toBe(false); // no-source case still uses SDK flag
        const healthy = document.createElement('audio');
        vi.spyOn(healthy, 'paused', 'get').mockReturnValue(false);
        playback.add(healthy);
        expect(playback.sync()).toBe(true);
        const blocked = document.createElement('audio');
        vi.spyOn(blocked, 'paused', 'get').mockReturnValue(fault === 'paused');
        if (fault === 'ended') vi.spyOn(blocked, 'ended', 'get').mockReturnValue(true);
        if (fault === 'error') Object.defineProperty(blocked, 'error', { value: { code: 3 }, configurable: true });
        playback.add(blocked);
        expect(onChange).toHaveBeenLastCalledWith(false);
        room.canPlaybackAudio = true;
        room.emit(RoomEvent.AudioPlaybackStatusChanged, true);
        expect(onChange).toHaveBeenLastCalledWith(false);
        playback.remove(blocked);
        expect(playback.sync()).toBe(true);
        room.state = 'reconnecting';
        room.emit(RoomEvent.ConnectionStateChanged, room.state);
        expect(onChange).toHaveBeenLastCalledWith(false);
        room.state = 'connected';
        room.canPlaybackAudio = false;
        playback.remove(healthy);
        expect(playback.sync()).toBe(false); // removal cannot latch native success
        playback.dispose();
    });

    it('does not confuse intentional gain or mute with blocked playback', () => {
        const { playback } = fixture();
        const audio = document.createElement('audio');
        vi.spyOn(audio, 'paused', 'get').mockReturnValue(false);
        audio.muted = true;
        audio.volume = 0;
        playback.add(audio);
        expect(playback.sync()).toBe(true);
        playback.dispose();
    });

    it('ignores removed elements and obsolete room events after cleanup', () => {
        const { room, playback, onChange } = fixture();
        const audio = document.createElement('audio');
        playback.add(audio);
        expect(playback.sync()).toBe(false);
        playback.remove(audio);
        expect(playback.sync()).toBe(true);
        onChange.mockClear();
        audio.dispatchEvent(new Event('pause'));
        expect(onChange).not.toHaveBeenCalled();
        playback.dispose();
        room.emit(RoomEvent.AudioPlaybackStatusChanged, false);
        expect(playback.sync()).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        expect(room.listenerCount(RoomEvent.AudioPlaybackStatusChanged)).toBe(0);
    });
});
