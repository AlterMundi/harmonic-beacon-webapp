import { RoomEvent, type Room } from 'livekit-client';

/** Playback permission is not a click receipt, nor a measurement of audibility.
 * Native-output contract only (the SDK default webAudioMix: false): observe
 * every owned native element, falling back to the public SDK playback flag
 * when no output exists. Never touch gains, attachment, devices or subscriptions.
 * The SDK's unused auxiliary context is not this remote output path. Enabling
 * WebAudio mixing requires a separate readiness/control contract; fail closed
 * rather than silently qualifying that route with native-only observations.
 */
export function observeRoomAudioPlayback(room: Room, onChange: (enabled: boolean) => void) {
    const elements = new Set<HTMLMediaElement>();
    let disposed = false;
    const sync = () => {
        // connect() can finish acquiring an unused suspended SDK context AFTER
        // native playback succeeds and overwrite canPlaybackAudio with false.
        // With owned native outputs, their current state is the evidence; the
        // SDK flag is only the fallback when no output exists yet. Never latch
        // success: a later blocked/ended/errored source still invalidates it.
        const nativeReady = elements.size > 0 ? [...elements].every(
            (element) => !element.paused && !element.ended && !element.error,
        ) : room.canPlaybackAudio;
        const enabled = room.options.webAudioMix === false &&
            room.state === 'connected' && nativeReady;
        if (!disposed) onChange(enabled);
        return !disposed && enabled;
    };
    const events = ['playing', 'pause', 'ended', 'error', 'emptied'] as const;
    const add = (element: HTMLMediaElement) => {
        elements.add(element);
        events.forEach((event) => element.addEventListener(event, sync));
        sync();
    };
    const remove = (element: HTMLMediaElement) => {
        events.forEach((event) => element.removeEventListener(event, sync));
        elements.delete(element);
        sync();
    };
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync);
    room.on(RoomEvent.Reconnected, sync);
    room.on(RoomEvent.ConnectionStateChanged, sync);
    return {
        sync,
        add,
        remove,
        dispose() {
            disposed = true;
            room.off(RoomEvent.AudioPlaybackStatusChanged, sync);
            room.off(RoomEvent.Reconnected, sync);
            room.off(RoomEvent.ConnectionStateChanged, sync);
            elements.forEach(remove);
        },
    };
}
