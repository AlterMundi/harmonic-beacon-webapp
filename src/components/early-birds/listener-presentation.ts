export type ListenerPresentationPhase =
    | 'ready'
    | 'preparing'
    | 'intro'
    | 'beacon'
    | 'paused'
    | 'reconnecting'
    | 'stopped'
    | 'unavailable'
    | 'displaced';

export function deriveListenerPresentationPhase({
    liveState,
    livePreparing,
    playingDrop,
    transportPaused,
    transportStopped,
    hasStarted,
}: {
    liveState: 'idle' | 'loading' | 'recovering' | 'playing' | 'paused' | 'error' | 'displaced';
    livePreparing: boolean;
    playingDrop: 'es' | 'en' | null;
    transportPaused: boolean;
    transportStopped: boolean;
    hasStarted: boolean;
}): ListenerPresentationPhase {
    if (liveState === 'displaced') return 'displaced';
    if (liveState === 'error') return 'unavailable';
    if (transportPaused) return 'paused';
    // The introduction remains the audible source while the hidden Beacon
    // pipeline is repaired. Its state is more truthful than a reconnect label
    // for media the listener cannot hear yet.
    if (playingDrop) return 'intro';
    if (liveState === 'recovering') return 'reconnecting';
    if (transportStopped) return hasStarted ? 'stopped' : 'ready';
    if (liveState === 'playing') return 'beacon';
    if (livePreparing || liveState === 'loading') return 'preparing';
    return hasStarted ? 'stopped' : 'ready';
}
