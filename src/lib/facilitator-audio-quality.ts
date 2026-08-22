export const FACILITATOR_AUDIO_PROFILE = {
    version: 1,
    codec: 'audio/opus',
    maxBitrateKbps: 96,
    sampleRateHz: 48_000,
    channelCount: 1,
    dtx: false,
    red: true,
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
    voiceIsolation: false,
} as const;

export const FACILITATOR_AUDIO_TELEMETRY_TOPIC = 'hb.facilitator-audio.v1';
export const FACILITATOR_AUDIO_SAMPLE_MS = 2_000;
export const FACILITATOR_AUDIO_STALE_MS = 7_000;

export type AudioQualityPlane = 'uplink' | 'downlink';
export type AudioQualitySeverity = 'healthy' | 'warning' | 'critical' | 'waiting';

export type SafeCaptureSettings = {
    sampleRateHz?: number;
    channelCount?: number;
    autoGainControl?: boolean;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    voiceIsolation?: boolean;
};

export type AudioQualityMeasurement = {
    sampledAt: number;
    plane: AudioQualityPlane;
    bitrateKbps?: number;
    packetLossPct?: number;
    jitterMs?: number;
    roundTripTimeMs?: number;
    concealmentPct?: number;
    availableBitrateKbps?: number;
    audioLevel?: number;
    codec?: string;
    connectionQuality?: string;
    capture?: SafeCaptureSettings;
};

export type FacilitatorAudioTelemetry = {
    version: 1;
    profileVersion: 1;
    measurement: AudioQualityMeasurement;
};

export type AudioStatsBaseline = {
    timestampMs: number;
    bytes: number;
    packets: number;
    packetsLost: number;
    concealedSamples: number;
    totalSamples: number;
};

export type AudioQualityAssessment = {
    severity: AudioQualitySeverity;
    reasons: string[];
};

type Stat = Record<string, unknown> & { id?: string; type?: string };

function finite(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function nonNegativeDelta(current: number, previous: number): number | undefined {
    const delta = current - previous;
    return delta >= 0 ? delta : undefined;
}

function rounded(value: number | undefined, digits = 1): number | undefined {
    if (value === undefined) return undefined;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function statsArray(report: RTCStatsReport | Iterable<unknown>): Stat[] {
    const values: Stat[] = [];
    if ('forEach' in report && typeof report.forEach === 'function') {
        report.forEach((value: unknown) => {
            if (value && typeof value === 'object') values.push(value as Stat);
        });
        return values;
    }
    for (const entry of report) {
        const value = Array.isArray(entry) && entry.length === 2 ? entry[1] : entry;
        if (value && typeof value === 'object') values.push(value as Stat);
    }
    return values;
}

function isAudioStat(stat: Stat): boolean {
    return stat.kind === 'audio' || stat.mediaType === 'audio';
}

function selectedCandidatePair(stats: Stat[]): Stat | undefined {
    const transport = stats.find((stat) => stat.type === 'transport');
    const selectedId = typeof transport?.selectedCandidatePairId === 'string'
        ? transport.selectedCandidatePairId
        : undefined;
    return stats.find((stat) => stat.type === 'candidate-pair' && (
        stat.id === selectedId || (stat.nominated === true && stat.state === 'succeeded')
    ));
}

function codecFor(stats: Stat[], rtp: Stat | undefined): string | undefined {
    const codecId = typeof rtp?.codecId === 'string' ? rtp.codecId : undefined;
    const codec = stats.find((stat) => stat.type === 'codec' && stat.id === codecId);
    return typeof codec?.mimeType === 'string' ? codec.mimeType.toLowerCase() : undefined;
}

function safeCaptureSettings(settings: MediaTrackSettings | undefined): SafeCaptureSettings | undefined {
    if (!settings) return undefined;
    const capture: SafeCaptureSettings = {
        sampleRateHz: finite(settings.sampleRate),
        channelCount: finite(settings.channelCount),
        autoGainControl: boolean(settings.autoGainControl),
        echoCancellation: boolean(settings.echoCancellation),
        noiseSuppression: boolean(settings.noiseSuppression),
        voiceIsolation: boolean((settings as MediaTrackSettings & { voiceIsolation?: boolean }).voiceIsolation),
    };
    return Object.values(capture).some((value) => value !== undefined) ? capture : undefined;
}

/**
 * Converts browser WebRTC counters into a bounded, identity-free measurement.
 * The function observes stats only; it has no reference to media controls.
 */
export function measureAudioQuality(
    report: RTCStatsReport | Iterable<unknown>,
    plane: AudioQualityPlane,
    previous?: AudioStatsBaseline,
    options: {
        sampledAt?: number;
        connectionQuality?: string;
        captureSettings?: MediaTrackSettings;
    } = {},
): { measurement: AudioQualityMeasurement; baseline: AudioStatsBaseline } | null {
    const stats = statsArray(report);
    const rtp = stats.find((stat) => (
        stat.type === (plane === 'uplink' ? 'outbound-rtp' : 'inbound-rtp') && isAudioStat(stat)
    ));
    if (!rtp) return null;

    const remoteInbound = plane === 'uplink'
        ? stats.find((stat) => stat.type === 'remote-inbound-rtp' && isAudioStat(stat))
        : undefined;
    const networkStat = remoteInbound ?? rtp;
    const candidatePair = selectedCandidatePair(stats);
    const timestampMs = finite(rtp.timestamp) ?? options.sampledAt ?? Date.now();
    const bytes = finite(plane === 'uplink' ? rtp.bytesSent : rtp.bytesReceived) ?? 0;
    const packets = finite(plane === 'uplink' ? networkStat?.packetsReceived : rtp.packetsReceived)
        ?? finite(rtp.packetsSent)
        ?? 0;
    const packetsLost = finite(networkStat?.packetsLost) ?? 0;
    const concealedSamples = finite(rtp.concealedSamples) ?? 0;
    const totalSamplesReceived = finite(rtp.totalSamplesReceived);
    const totalSamplesDuration = finite(rtp.totalSamplesDuration);
    const codecClockRate = finite(stats.find((stat) => stat.id === rtp.codecId)?.clockRate) ?? 48_000;
    const totalSamples = totalSamplesReceived ?? ((totalSamplesDuration ?? 0) * codecClockRate);
    const baseline: AudioStatsBaseline = {
        timestampMs,
        bytes,
        packets,
        packetsLost,
        concealedSamples,
        totalSamples,
    };

    let bitrateKbps: number | undefined;
    let packetLossPct: number | undefined;
    let concealmentPct: number | undefined;
    if (previous) {
        const elapsedMs = nonNegativeDelta(timestampMs, previous.timestampMs);
        const byteDelta = nonNegativeDelta(bytes, previous.bytes);
        if (elapsedMs && byteDelta !== undefined) {
            bitrateKbps = (byteDelta * 8) / elapsedMs;
        }

        const packetDelta = nonNegativeDelta(packets, previous.packets);
        const lostDelta = nonNegativeDelta(packetsLost, previous.packetsLost);
        if (packetDelta !== undefined && lostDelta !== undefined && packetDelta + lostDelta > 0) {
            packetLossPct = (lostDelta / (packetDelta + lostDelta)) * 100;
        } else {
            const fractionLost = finite(networkStat?.fractionLost);
            if (fractionLost !== undefined) packetLossPct = fractionLost * 100;
        }

        if (plane === 'downlink') {
            const concealedDelta = nonNegativeDelta(concealedSamples, previous.concealedSamples);
            const sampleDelta = nonNegativeDelta(totalSamples, previous.totalSamples);
            if (concealedDelta !== undefined && sampleDelta && sampleDelta > 0) {
                concealmentPct = (concealedDelta / sampleDelta) * 100;
            }
        }
    }

    const roundTripTimeSeconds = finite(remoteInbound?.roundTripTime)
        ?? finite(candidatePair?.currentRoundTripTime);
    const availableBitrate = finite(
        plane === 'uplink'
            ? candidatePair?.availableOutgoingBitrate
            : candidatePair?.availableIncomingBitrate,
    );

    return {
        baseline,
        measurement: {
            sampledAt: options.sampledAt ?? Date.now(),
            plane,
            bitrateKbps: rounded(bitrateKbps),
            packetLossPct: rounded(packetLossPct, 2),
            jitterMs: rounded(finite(networkStat?.jitter) === undefined
                ? undefined
                : finite(networkStat?.jitter)! * 1_000),
            roundTripTimeMs: rounded(roundTripTimeSeconds === undefined ? undefined : roundTripTimeSeconds * 1_000),
            concealmentPct: rounded(concealmentPct, 2),
            availableBitrateKbps: rounded(availableBitrate === undefined ? undefined : availableBitrate / 1_000),
            audioLevel: rounded(finite(rtp.audioLevel)
                ?? finite(stats.find((stat) => stat.type === 'media-source' && isAudioStat(stat))?.audioLevel), 3),
            codec: codecFor(stats, rtp),
            connectionQuality: options.connectionQuality,
            capture: plane === 'uplink' ? safeCaptureSettings(options.captureSettings) : undefined,
        },
    };
}

export function assessAudioQuality(
    measurement: AudioQualityMeasurement | null,
    now = Date.now(),
): AudioQualityAssessment {
    if (!measurement) return { severity: 'waiting', reasons: ['no_measurement'] };
    if (now - measurement.sampledAt > FACILITATOR_AUDIO_STALE_MS) {
        return { severity: 'critical', reasons: ['stale'] };
    }

    const critical: string[] = [];
    const warning: string[] = [];
    const quality = measurement.connectionQuality?.toLowerCase();
    if (quality === 'lost') critical.push('connection_lost');
    else if (quality === 'poor') warning.push('connection_poor');
    if ((measurement.packetLossPct ?? 0) >= 5) critical.push('packet_loss');
    else if ((measurement.packetLossPct ?? 0) >= 2) warning.push('packet_loss');
    if ((measurement.jitterMs ?? 0) >= 50) critical.push('jitter');
    else if ((measurement.jitterMs ?? 0) >= 25) warning.push('jitter');
    if ((measurement.roundTripTimeMs ?? 0) >= 400) critical.push('rtt');
    else if ((measurement.roundTripTimeMs ?? 0) >= 200) warning.push('rtt');
    if ((measurement.concealmentPct ?? 0) >= 5) critical.push('concealment');
    else if ((measurement.concealmentPct ?? 0) >= 1) warning.push('concealment');
    // Opus legitimately spends fewer bits during silence even with DTX off.
    // Only call bitrate degraded while the browser reports active speech.
    const hasActiveAudio = (measurement.audioLevel ?? 0) >= 0.01;
    if (hasActiveAudio && measurement.bitrateKbps !== undefined && measurement.bitrateKbps < 32) critical.push('bitrate');
    else if (hasActiveAudio && measurement.bitrateKbps !== undefined && measurement.bitrateKbps < 48) warning.push('bitrate');

    if (measurement.plane === 'uplink' && measurement.capture) {
        const capture = measurement.capture;
        if ((capture.sampleRateHz ?? FACILITATOR_AUDIO_PROFILE.sampleRateHz) < 44_100) warning.push('sample_rate');
        if (capture.autoGainControl === true) warning.push('auto_gain_control');
        if (capture.echoCancellation === true) warning.push('echo_cancellation');
        if (capture.noiseSuppression === true) warning.push('noise_suppression');
        if (capture.voiceIsolation === true) warning.push('voice_isolation');
    }

    if (critical.length) return { severity: 'critical', reasons: [...new Set(critical)] };
    if (warning.length) return { severity: 'warning', reasons: [...new Set(warning)] };
    return { severity: 'healthy', reasons: [] };
}

export function encodeFacilitatorTelemetry(measurement: AudioQualityMeasurement): Uint8Array {
    const telemetry: FacilitatorAudioTelemetry = {
        version: 1,
        profileVersion: FACILITATOR_AUDIO_PROFILE.version,
        measurement,
    };
    return new TextEncoder().encode(JSON.stringify(telemetry));
}

export function parseFacilitatorTelemetry(payload: Uint8Array): FacilitatorAudioTelemetry | null {
    if (payload.byteLength > 4_096) return null;
    try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as Partial<FacilitatorAudioTelemetry>;
        if (parsed.version !== 1 || parsed.profileVersion !== 1 || !parsed.measurement) return null;
        const measurement = parsed.measurement;
        if (measurement.plane !== 'uplink' || !Number.isFinite(measurement.sampledAt)) return null;
        return parsed as FacilitatorAudioTelemetry;
    } catch {
        return null;
    }
}
