import { describe, expect, it } from 'vitest';

import {
    LISTENER_BUFFER_TARGET_SECONDS,
    listenerBufferedAheadSeconds,
    listenerHlsRecoveryAction,
    listenerRecoveryDelayMs,
    listenerTransportDiagnostic,
} from '../playback-resilience';

function ranges(values: Array<[number, number]>): TimeRanges {
    return {
        length: values.length,
        start: (index) => values[index][0],
        end: (index) => values[index][1],
    };
}

describe('Listener playback resilience', () => {
    it('targets three minutes and counts only the range containing the playhead', () => {
        expect(LISTENER_BUFFER_TARGET_SECONDS).toBe(180);
        expect(listenerBufferedAheadSeconds({
            currentTime: 42,
            buffered: ranges([[0, 20], [40, 112], [150, 210]]),
        })).toBe(70);
        expect(listenerBufferedAheadSeconds({
            currentTime: 120,
            buffered: ranges([[0, 20], [150, 210]]),
        })).toBe(0);
    });

    it('caps automatic recovery backoff at thirty seconds without giving up', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 50].map(listenerRecoveryDelayMs)).toEqual([
            0,
            1_000,
            2_000,
            4_000,
            8_000,
            15_000,
            30_000,
            30_000,
        ]);
    });

    it('keeps network and decoder recovery non-destructive where hls.js supports it', () => {
        expect(listenerHlsRecoveryAction('networkError')).toBe('restart-network-load');
        expect(listenerHlsRecoveryAction('mediaError')).toBe('recover-media');
        expect(listenerHlsRecoveryAction('muxError')).toBe('rebuild-pipeline');
    });

    it('emits a bounded transport diagnostic without identity or transport URLs', () => {
        const diagnostic = listenerTransportDiagnostic({
            reason: 'hls-fatal',
            action: 'restart-network-load',
            observedAtMs: 1_234,
            bufferedAheadSeconds: 92.75,
            recoveryAttempt: 1,
            hlsType: 'networkError',
            hlsDetails: 'fragLoadError',
        });
        expect(diagnostic).toMatchObject({
            schemaVersion: 1,
            transport: 'beacon',
            bufferedAheadSeconds: 92.75,
            recoveryAttempt: 1,
            hls: { type: 'networkError', details: 'fragLoadError' },
        });
        expect(JSON.stringify(diagnostic)).not.toMatch(/account|cookie|email|leaseId|token|url/i);

        const hostile = listenerTransportDiagnostic({
            reason: 'hls-fatal',
            action: 'restart-network-load',
            observedAtMs: 1_234,
            bufferedAheadSeconds: 0,
            recoveryAttempt: 2,
            hlsType: 'networkError',
            hlsDetails: 'https://stream.example/token=secret',
        });
        expect(hostile.hls).toEqual({ type: 'networkError', details: null });
    });
});
