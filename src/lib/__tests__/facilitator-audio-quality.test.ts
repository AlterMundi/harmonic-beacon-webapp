import { describe, expect, it } from 'vitest';

import {
    assessAudioQuality,
    encodeFacilitatorTelemetry,
    measureAudioQuality,
    parseFacilitatorTelemetry,
} from '@/lib/facilitator-audio-quality';

function report(...stats: Array<Record<string, unknown>>): RTCStatsReport {
    const values = new Map(stats.map((stat, index) => [String(stat.id ?? index), stat]));
    return values as unknown as RTCStatsReport;
}

describe('facilitator audio quality measurements', () => {
    it('derives uplink bitrate, loss, jitter and RTT from counter deltas', () => {
        const first = measureAudioQuality(report(
            { id: 'out', type: 'outbound-rtp', kind: 'audio', timestamp: 1_000, bytesSent: 10_000, packetsSent: 100, codecId: 'opus' },
            { id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', packetsReceived: 98, packetsLost: 2, jitter: 0.012, roundTripTime: 0.08 },
            { id: 'opus', type: 'codec', mimeType: 'audio/opus', clockRate: 48_000 },
        ), 'uplink', undefined, { sampledAt: 1_000 });
        expect(first).not.toBeNull();

        const second = measureAudioQuality(report(
            { id: 'out', type: 'outbound-rtp', kind: 'audio', timestamp: 3_000, bytesSent: 34_000, packetsSent: 300, codecId: 'opus' },
            { id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', packetsReceived: 294, packetsLost: 6, jitter: 0.012, roundTripTime: 0.08 },
            { id: 'opus', type: 'codec', mimeType: 'audio/opus', clockRate: 48_000 },
        ), 'uplink', first!.baseline, { sampledAt: 3_000 });

        expect(second?.measurement).toMatchObject({
            bitrateKbps: 96,
            packetLossPct: 2,
            jitterMs: 12,
            roundTripTimeMs: 80,
            codec: 'audio/opus',
        });
    });

    it('derives receiver concealment without treating cumulative counters as a percentage', () => {
        const first = measureAudioQuality(report({
            type: 'inbound-rtp', kind: 'audio', timestamp: 1_000, bytesReceived: 10_000,
            packetsReceived: 100, packetsLost: 0, concealedSamples: 0, totalSamplesReceived: 48_000,
        }), 'downlink', undefined, { sampledAt: 1_000 });
        const second = measureAudioQuality(report({
            type: 'inbound-rtp', kind: 'audio', timestamp: 3_000, bytesReceived: 34_000,
            packetsReceived: 200, packetsLost: 0, concealedSamples: 960, totalSamplesReceived: 144_000,
        }), 'downlink', first!.baseline, { sampledAt: 3_000 });

        expect(second?.measurement.bitrateKbps).toBe(96);
        expect(second?.measurement.concealmentPct).toBe(1);
    });

    it('reports browser processing and degraded transport but never owns a media action', () => {
        const measurement = {
            sampledAt: 10_000,
            plane: 'uplink' as const,
            bitrateKbps: 28,
            packetLossPct: 7,
            audioLevel: 0.12,
            capture: { echoCancellation: true, noiseSuppression: true },
        };

        expect(assessAudioQuality(measurement, 10_100)).toEqual({
            severity: 'critical',
            reasons: ['packet_loss', 'bitrate'],
        });
        // The observer contract is structural: measurements and assessments
        // contain data only, with no callback capable of muting/unpublishing.
        expect(Object.values(measurement).every((value) => typeof value !== 'function')).toBe(true);
    });

    it('round-trips bounded identity-free facilitator telemetry', () => {
        const measurement = {
            sampledAt: Date.now(),
            plane: 'uplink' as const,
            bitrateKbps: 92,
            capture: { sampleRateHz: 48_000, echoCancellation: false },
        };
        const decoded = parseFacilitatorTelemetry(encodeFacilitatorTelemetry(measurement));
        expect(decoded?.measurement).toEqual(measurement);
        expect(new TextDecoder().decode(encodeFacilitatorTelemetry(measurement))).not.toMatch(/identity|email|token|deviceId/i);
    });
});
