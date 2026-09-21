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
    type Source = MediaProvider | string;
    type Evidence = {
        source: Source | null;
        generation: number;
        generationReady: boolean;
        onEvent: (event: Event) => void;
    };

    const elements = new Map<HTMLMediaElement, Evidence>();
    let disposed = false;
    const currentSource = (element: HTMLMediaElement): Source | null =>
        element.srcObject ?? (element.currentSrc || null);
    const sync = () => {
        // connect() can finish acquiring an unused suspended SDK context AFTER
        // native playback succeeds and overwrite canPlaybackAudio with false.
        // With owned native outputs, their current state is the evidence; the
        // SDK flag is only the fallback when no output exists yet. Never latch
        // success: a later blocked/ended/errored source still invalidates it.
        const nativeReady = elements.size > 0 ? [...elements].every(
            ([element, evidence]) => {
                const source = currentSource(element);
                if (source !== evidence.source) bindSourceGeneration(element, evidence, source, false);
                return evidence.generationReady &&
                    !element.paused && !element.ended && !element.error;
            },
        ) : room.canPlaybackAudio;
        const enabled = room.options.webAudioMix === false &&
            room.state === 'connected' && nativeReady;
        if (!disposed) onChange(enabled);
        return !disposed && enabled;
    };
    const events = ['playing', 'pause', 'ended', 'error', 'emptied'] as const;
    function bindSourceGeneration(
        element: HTMLMediaElement,
        evidence: Evidence,
        source: Source | null,
        generationReady: boolean,
    ) {
        events.forEach((event) => element.removeEventListener(event, evidence.onEvent));
        evidence.source = source;
        evidence.generation += 1;
        evidence.generationReady = generationReady;
        const generation = evidence.generation;
        const onEvent = (event: Event) => {
            const eventSource = currentSource(element);
            if (eventSource !== evidence.source) {
                bindSourceGeneration(element, evidence, eventSource, false);
                sync();
                return;
            }
            // Removing a listener cannot cancel a callback already queued by the
            // browser. Only the callback bound to this source generation may add
            // readiness evidence for it.
            if (generation !== evidence.generation) {
                sync();
                return;
            }
            if (event.type === 'playing') evidence.generationReady = true;
            sync();
        };
        evidence.onEvent = onEvent;
        events.forEach((event) => element.addEventListener(event, onEvent));
    }
    const add = (element: HTMLMediaElement) => {
        if (elements.has(element)) {
            sync();
            return;
        }
        const evidence: Evidence = {
            source: null,
            generation: 0,
            generationReady: true,
            onEvent: () => undefined,
        };
        elements.set(element, evidence);
        bindSourceGeneration(element, evidence, currentSource(element), true);
        sync();
    };
    const remove = (element: HTMLMediaElement) => {
        const evidence = elements.get(element);
        if (evidence) {
            events.forEach((event) => element.removeEventListener(event, evidence.onEvent));
            elements.delete(element);
        }
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
            elements.forEach((_evidence, element) => remove(element));
        },
    };
}
