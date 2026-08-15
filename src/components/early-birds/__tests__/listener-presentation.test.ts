import { describe, expect, it } from 'vitest';

import { deriveListenerPresentationPhase } from '../listener-presentation';

const baseline = {
    liveState: 'idle' as const,
    livePreparing: false,
    playingDrop: null,
    transportPaused: false,
    transportStopped: true,
    hasStarted: false,
};

describe('Listener presentation phase', () => {
    it('distinguishes first readiness from a deliberate stop', () => {
        expect(deriveListenerPresentationPhase(baseline)).toBe('ready');
        expect(deriveListenerPresentationPhase({ ...baseline, hasStarted: true })).toBe('stopped');
    });

    it('tracks intro, Beacon, pause and recovery without inventing signal state', () => {
        expect(deriveListenerPresentationPhase({
            ...baseline,
            transportStopped: false,
            playingDrop: 'en',
        })).toBe('intro');
        expect(deriveListenerPresentationPhase({
            ...baseline,
            transportStopped: false,
            liveState: 'playing',
        })).toBe('beacon');
        expect(deriveListenerPresentationPhase({
            ...baseline,
            transportStopped: false,
            transportPaused: true,
        })).toBe('paused');
        expect(deriveListenerPresentationPhase({
            ...baseline,
            transportStopped: false,
            liveState: 'recovering',
        })).toBe('reconnecting');
        expect(deriveListenerPresentationPhase({
            ...baseline,
            transportStopped: false,
            liveState: 'recovering',
            playingDrop: 'en',
        })).toBe('intro');
    });

    it('gives access and transport failures precedence', () => {
        expect(deriveListenerPresentationPhase({ ...baseline, liveState: 'error' })).toBe('unavailable');
        expect(deriveListenerPresentationPhase({ ...baseline, liveState: 'displaced' })).toBe('displaced');
    });
});
