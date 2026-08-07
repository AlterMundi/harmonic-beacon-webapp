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
    if (liveState === 'recovering') return 'reconnecting';
    if (transportPaused) return 'paused';
    if (transportStopped) return hasStarted ? 'stopped' : 'ready';
    if (playingDrop) return 'intro';
    if (liveState === 'playing') return 'beacon';
    if (livePreparing || liveState === 'loading') return 'preparing';
    return hasStarted ? 'stopped' : 'ready';
}
