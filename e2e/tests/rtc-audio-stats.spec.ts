import { expect, test } from '@playwright/test';

import {
    installMediaProbe,
    rtcAudioStatsSnapshot,
} from '../helpers/media-probe';

test.describe('sanitized RTC audio diagnostics', () => {
    test('keeps useful quality metrics and drops identities, candidates and device ids', async ({ page }) => {
        await installMediaProbe(page);
        await page.goto('about:blank');

        await page.evaluate(() => {
            const peerConnection = new RTCPeerConnection();
            const report = new Map<string, Record<string, unknown>>([
                ['codec-private-id', {
                    id: 'codec-private-id',
                    type: 'codec',
                    mimeType: 'audio/opus',
                    clockRate: 48_000,
                    channels: 2,
                    sdpFmtpLine: 'private-fmtp',
                }],
                ['inbound-private-id', {
                    id: 'inbound-private-id',
                    type: 'inbound-rtp',
                    kind: 'audio',
                    codecId: 'codec-private-id',
                    ssrc: 123_456,
                    trackIdentifier: 'participant-private-track',
                    packetsReceived: 1_000,
                    packetsLost: 4,
                    jitter: 0.012,
                    audioLevel: 0.42,
                    concealedSamples: 17,
                    silentConcealedSamples: 3,
                    concealmentEvents: 2,
                    jitterBufferDelay: 1.5,
                    jitterBufferEmittedCount: 500,
                }],
                ['outbound-private-id', {
                    id: 'outbound-private-id',
                    type: 'outbound-rtp',
                    codecId: 'codec-private-id',
                    ssrc: 654_321,
                    packetsSent: 900,
                    retransmittedPacketsSent: 1,
                    audioLevel: 0.31,
                    totalAudioEnergy: 12.5,
                    totalSamplesDuration: 30,
                }],
                ['remote-private-id', {
                    id: 'remote-private-id',
                    type: 'remote-inbound-rtp',
                    localId: 'outbound-private-id',
                    packetsLost: 2,
                    fractionLost: 0.002,
                    jitter: 0.009,
                    roundTripTime: 0.08,
                    totalRoundTripTime: 8,
                    roundTripTimeMeasurements: 100,
                }],
                ['transport-private-id', {
                    id: 'transport-private-id',
                    type: 'transport',
                    selectedCandidatePairId: 'candidate-pair-private-id',
                }],
                ['candidate-pair-private-id', {
                    id: 'candidate-pair-private-id',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    localCandidateId: 'local-private-id',
                    remoteCandidateId: 'remote-private-id',
                    currentRoundTripTime: 0.07,
                    availableIncomingBitrate: 128_000,
                    availableOutgoingBitrate: 96_000,
                    address: '192.0.2.1',
                    port: 34_788,
                }],
            ]);

            Object.defineProperty(peerConnection, 'getStats', {
                value: async () => report,
            });

            const audioTrack = {
                kind: 'audio',
                readyState: 'live',
                getSettings: () => ({
                    sampleRate: 48_000,
                    sampleSize: 16,
                    channelCount: 1,
                    latency: 0.01,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    deviceId: 'private-device-id',
                    groupId: 'private-group-id',
                }),
            } as unknown as MediaStreamTrack;
            Object.defineProperty(peerConnection, 'getSenders', {
                value: () => [{ track: audioTrack }],
            });
            Object.defineProperty(peerConnection, 'getReceivers', {
                value: () => [{ track: audioTrack }],
            });

            (window as unknown as { __rtcTestPeer?: RTCPeerConnection }).__rtcTestPeer =
                peerConnection;
        });

        const snapshot = await rtcAudioStatsSnapshot(page);

        expect(snapshot.activePeerConnections).toBe(1);
        expect(snapshot.collectionErrors).toBe(0);
        expect(snapshot.peerConnections).toEqual([
            expect.objectContaining({
                peerConnection: 1,
                inbound: [expect.objectContaining({
                    packetsReceived: 1_000,
                    packetsLost: 4,
                    jitterSeconds: 0.012,
                    concealedSamples: 17,
                    jitterBufferMeanDelayMs: 3,
                })],
                outbound: [expect.objectContaining({ packetsSent: 900 })],
                remoteInbound: [expect.objectContaining({
                    roundTripTimeSeconds: 0.08,
                    packetsLost: 2,
                })],
                selectedCandidatePairs: [expect.objectContaining({
                    currentRoundTripTimeSeconds: 0.07,
                })],
                codecs: [{ mimeType: 'audio/opus', clockRate: 48_000, channels: 2 }],
                trackSettings: [
                    expect.objectContaining({ direction: 'send', sampleRate: 48_000 }),
                    expect.objectContaining({ direction: 'receive', sampleRate: 48_000 }),
                ],
            }),
        ]);

        const serialized = JSON.stringify(snapshot);
        for (const privateValue of [
            'private-id',
            'private-track',
            'private-device',
            'private-group',
            '192.0.2.1',
            '34788',
            'private-fmtp',
        ]) {
            expect(serialized).not.toContain(privateValue);
        }

        const keys = new Set<string>();
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (!value || typeof value !== 'object') return;
            for (const [key, nested] of Object.entries(value)) {
                keys.add(key);
                visit(nested);
            }
        };
        visit(snapshot);
        expect([...keys].filter((key) => /^(id|ssrc|trackIdentifier|deviceId|groupId|address|ip|port|url|token)$/i.test(key)))
            .toEqual([]);
    });

    test('isolates an unreadable peer connection without losing healthy evidence', async ({ page }) => {
        await installMediaProbe(page);
        await page.goto('about:blank');

        await page.evaluate(() => {
            const healthy = new RTCPeerConnection();
            Object.defineProperty(healthy, 'getStats', {
                value: async () => new Map(),
            });
            const unreadable = new RTCPeerConnection();
            Object.defineProperty(unreadable, 'getStats', {
                value: async () => {
                    throw new DOMException('closed', 'InvalidStateError');
                },
            });
            (window as unknown as { __rtcTestPeers?: RTCPeerConnection[] }).__rtcTestPeers = [
                healthy,
                unreadable,
            ];
        });

        const snapshot = await rtcAudioStatsSnapshot(page);
        expect(snapshot.activePeerConnections).toBe(2);
        expect(snapshot.collectionErrors).toBe(1);
        expect(snapshot.peerConnections).toHaveLength(1);
    });
});
