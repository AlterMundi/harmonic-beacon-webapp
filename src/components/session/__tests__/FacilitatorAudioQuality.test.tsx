// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('livekit-client', () => ({
    RoomEvent: { DataReceived: 'dataReceived' },
    Track: { Source: { Microphone: 'microphone' } },
}));

import FacilitatorAudioQuality from '../FacilitatorAudioQuality';

function stats(values: Array<Record<string, unknown>>): RTCStatsReport {
    return new Map(values.map((value, index) => [String(value.id ?? index), value])) as unknown as RTCStatsReport;
}

describe('FacilitatorAudioQuality', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('shows real degradation to Staff without touching the transmission', async () => {
        const reports = [
            stats([
                { type: 'outbound-rtp', kind: 'audio', timestamp: 1_000, bytesSent: 10_000, packetsSent: 100, audioLevel: 0.12 },
                { type: 'remote-inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0.01, roundTripTime: 0.08 },
            ]),
            stats([
                { type: 'outbound-rtp', kind: 'audio', timestamp: 3_000, bytesSent: 17_000, packetsSent: 200, audioLevel: 0.12 },
                { type: 'remote-inbound-rtp', kind: 'audio', packetsReceived: 185, packetsLost: 15, jitter: 0.065, roundTripTime: 0.45 },
            ]),
        ];
        let reportIndex = 0;
        const setMicrophoneEnabled = vi.fn();
        const unpublishTrack = vi.fn();
        const disconnect = vi.fn();
        const publishData = vi.fn().mockResolvedValue(undefined);
        const listeners = new Map<string, (...args: unknown[]) => void>();
        const room = {
            localParticipant: {
                connectionQuality: 'excellent',
                getTrackPublication: () => ({
                    audioTrack: {
                        getRTCStatsReport: vi.fn(async () => reports[Math.min(reportIndex++, reports.length - 1)]),
                        getSourceTrackSettings: () => ({
                            sampleRate: 48_000,
                            channelCount: 1,
                            autoGainControl: false,
                            echoCancellation: false,
                            noiseSuppression: false,
                        }),
                    },
                }),
                publishData,
                setMicrophoneEnabled,
                unpublishTrack,
            },
            remoteParticipants: new Map([['staff', {
                identity: 'opaque-staff',
                metadata: JSON.stringify({ role: 'ADMIN', isAssignedFacilitator: false }),
            }]]),
            on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
            off: vi.fn((event: string) => listeners.delete(event)),
            disconnect,
        };

        render(
            <LocaleProvider initialLocale="en">
                <FacilitatorAudioQuality
                    room={room as never}
                    isStaff
                    isAssignedFacilitator
                />
            </LocaleProvider>,
        );
        await act(async () => Promise.resolve());
        await act(async () => {
            vi.advanceTimersByTime(2_000);
            await Promise.resolve();
        });

        expect(screen.getByTestId('facilitator-audio-quality')).toHaveAttribute('data-severity', 'critical');
        expect(screen.getByText(/Packet loss is above/)).toBeInTheDocument();
        expect(publishData).toHaveBeenCalled();
        expect(setMicrophoneEnabled).not.toHaveBeenCalled();
        expect(unpublishTrack).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
    });
});
