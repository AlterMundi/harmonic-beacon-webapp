// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
    LISTENER_PLAYBACK_EXHAUSTED_STALL_AFTER_MS,
    LISTENER_PLAYBACK_STALL_AFTER_MS,
    ListenerPlaybackLivenessWatchdog,
    listenerPlaybackObservation,
} from '../playback-liveness';

function observation(overrides: Partial<Parameters<ListenerPlaybackLivenessWatchdog['observe']>[0]> = {}) {
    return {
        transport: 'beacon' as const,
        lastAction: 'listen',
        observedAtMs: 0,
        media: {
            currentTimeSeconds: 42,
            paused: false,
            ended: false,
            readyState: 4,
            networkState: 1,
            muted: false,
            volume: 0.7,
            playbackRate: 1,
            errorCode: null,
            bufferedRangeCount: 1,
            bufferedEndSeconds: 72,
            bufferedAheadSeconds: 30,
            seekableRangeCount: 1,
            seekableEndSeconds: 90,
        },
        lease: { generation: 3, presenceSequence: 7 },
        hls: { type: null, details: null, fatal: null },
        visibility: 'visible' as const,
        ...overrides,
    };
}

describe('ListenerPlaybackLivenessWatchdog', () => {
    it('accepts slow progress and resets across a live-edge jump', () => {
        const watchdog = new ListenerPlaybackLivenessWatchdog();
        expect(watchdog.observe(observation())).toBeNull();
        expect(watchdog.observe(observation({
            observedAtMs: LISTENER_PLAYBACK_STALL_AFTER_MS,
            media: { ...observation().media, currentTimeSeconds: 42.1 },
        }))).toBeNull();
        expect(watchdog.observe(observation({
            observedAtMs: LISTENER_PLAYBACK_STALL_AFTER_MS * 2,
            media: { ...observation().media, currentTimeSeconds: 8 },
        }))).toBeNull();
    });

    it('reports a bounded privacy-safe snapshot after a silent media-clock stall', () => {
        const watchdog = new ListenerPlaybackLivenessWatchdog();
        expect(watchdog.observe(observation())).toBeNull();
        const diagnostic = watchdog.observe(observation({
            observedAtMs: LISTENER_PLAYBACK_STALL_AFTER_MS,
        }));

        expect(diagnostic).toMatchObject({
            schemaVersion: 1,
            reason: 'media-clock-stalled',
            stalledForMs: LISTENER_PLAYBACK_STALL_AFTER_MS,
            lease: { generation: 3, presenceSequence: 7 },
        });
        expect(JSON.stringify(diagnostic)).not.toMatch(/leaseId|account|email|cookie|token|url/i);
    });

    it('classifies paused, ended and media-error failures without changing thresholds', () => {
        for (const [field, expected] of [
            ['paused', 'paused-unexpectedly'],
            ['ended', 'ended-unexpectedly'],
        ] as const) {
            const watchdog = new ListenerPlaybackLivenessWatchdog();
            expect(watchdog.observe(observation())).toBeNull();
            expect(watchdog.observe(observation({
                observedAtMs: LISTENER_PLAYBACK_STALL_AFTER_MS,
                media: { ...observation().media, [field]: true },
            }))).toMatchObject({ reason: expected });
        }

        const watchdog = new ListenerPlaybackLivenessWatchdog();
        expect(watchdog.observe(observation())).toBeNull();
        expect(watchdog.observe(observation({
            observedAtMs: 1,
            media: { ...observation().media, errorCode: 2 },
        }))).toMatchObject({ reason: 'media-error' });
    });

    it('recognizes exhausted media quickly only after a fatal network signal', () => {
        const watchdog = new ListenerPlaybackLivenessWatchdog();
        const exhausted = observation({
            media: { ...observation().media, bufferedAheadSeconds: 0 },
            hls: { type: 'networkError', details: 'fragLoadError', fatal: true },
        });
        expect(watchdog.observe(exhausted)).toBeNull();
        expect(watchdog.observe({
            ...exhausted,
            observedAtMs: LISTENER_PLAYBACK_EXHAUSTED_STALL_AFTER_MS,
        })).toMatchObject({
            reason: 'media-clock-stalled',
            stalledForMs: LISTENER_PLAYBACK_EXHAUSTED_STALL_AFTER_MS,
        });
    });

    it('extracts range summaries without throwing or retaining range contents', () => {
        const audio = document.createElement('audio');
        Object.defineProperties(audio, {
            currentTime: { value: 12.5, configurable: true },
            buffered: {
                value: { length: 1, start: () => 3, end: () => 18 },
                configurable: true,
            },
            seekable: {
                value: { length: 1, start: () => 0, end: () => 24 },
                configurable: true,
            },
        });
        const snapshot = listenerPlaybackObservation({
            audio,
            observedAtMs: 100,
            lastAction: 'listen',
            leaseGeneration: 2,
            presenceSequence: 4,
            hlsSignal: { type: 'networkError', details: 'manifestLoadError', fatal: false },
            visibility: 'visible',
        });
        expect(snapshot.media).toMatchObject({
            currentTimeSeconds: 12.5,
            bufferedRangeCount: 1,
            bufferedEndSeconds: 18,
            bufferedAheadSeconds: 5.5,
            seekableRangeCount: 1,
            seekableEndSeconds: 24,
        });
    });
});
