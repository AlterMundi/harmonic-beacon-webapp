import { describe, it, expect, vi } from 'vitest';
import type { Room } from 'livekit-client';
import { setMicrophoneEchoCancellation } from '../microphone-echo';
function fixture(trackPresent = true) {
    let echo = false;
    const track = {
        constraints: { deviceId: 'selected-mic', autoGainControl: false, noiseSuppression: false, sampleRate: { ideal: 48000 } },
        getSourceTrackSettings: () => ({ echoCancellation: echo, deviceId: 'selected-mic' }),
        restartTrack: vi.fn(async (options: {echoCancellation: boolean}) => { echo = options.echoCancellation; }),
    };
    const room = { options: { audioCaptureDefaults: { echoCancellation: false, autoGainControl: false } },
        localParticipant: { getTrackPublication: () => trackPresent ? { audioTrack: track } : undefined,
            setMicrophoneEnabled: vi.fn() } };
    return { room, track, typed: room as unknown as Room };
}
describe('local microphone echo selection', () => {
    it('preserves device and musical settings while toggling both directions', async () => {
        const { room, track, typed } = fixture();
        expect(await setMicrophoneEchoCancellation(typed, true)).toBe(true);
        expect(track.restartTrack).toHaveBeenCalledWith({ ...track.constraints, echoCancellation: true });
        expect(room.options.audioCaptureDefaults).toEqual({echoCancellation:true,autoGainControl:false});
        expect(await setMicrophoneEchoCancellation(typed, false)).toBe(false);
        expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });
    it('defers capture without obtaining or publishing a microphone', async () => {
        const { room, track, typed } = fixture(false);
        expect(await setMicrophoneEchoCancellation(typed, true)).toBeUndefined();
        expect(track.restartTrack).not.toHaveBeenCalled();
        expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
        expect(room.options.audioCaptureDefaults.echoCancellation).toBe(true);
    });
    it('does not record success when the browser ignores the setting', async () => {
        const { room, track, typed } = fixture();
        track.restartTrack.mockImplementation(async () => {});
        expect(await setMicrophoneEchoCancellation(typed,true)).toBe(false);
        expect(room.options.audioCaptureDefaults.echoCancellation).toBe(false);
    });
    it('propagates capture failure without changing the future preference', async () => {
        const { room, track, typed } = fixture();
        track.restartTrack.mockRejectedValue(new Error('denied'));
        await expect(setMicrophoneEchoCancellation(typed,true)).rejects.toThrow('denied');
        expect(room.options.audioCaptureDefaults.echoCancellation).toBe(false);
    });
});
