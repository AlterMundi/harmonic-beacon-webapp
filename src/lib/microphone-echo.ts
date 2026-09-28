import { Track, type AudioCaptureOptions, type Room } from 'livekit-client';

/** Preserve capture settings and mute state; never publish a new microphone. */
export async function setMicrophoneEchoCancellation(room: Room, enabled: boolean): Promise<boolean | undefined> {
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (track) {
        await track.restartTrack({
            ...track.constraints as AudioCaptureOptions,
            deviceId: track.constraints.deviceId ?? track.getSourceTrackSettings().deviceId ?? 'default',
            echoCancellation: enabled,
        });
        const applied = track.getSourceTrackSettings().echoCancellation;
        if (applied !== enabled) return applied;
    }
    room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, echoCancellation: enabled };
    return track ? track.getSourceTrackSettings().echoCancellation : undefined;
}
