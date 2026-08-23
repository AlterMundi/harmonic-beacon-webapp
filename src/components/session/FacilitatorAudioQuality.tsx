'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    RoomEvent,
    Track,
    type Participant,
    type Room,
} from 'livekit-client';

import { useLocale } from '@/context/LocaleContext';
import {
    FACILITATOR_AUDIO_SAMPLE_MS,
    FACILITATOR_AUDIO_TELEMETRY_TOPIC,
    assessAudioQuality,
    encodeFacilitatorTelemetry,
    measureAudioQuality,
    parseFacilitatorTelemetry,
    type AudioQualityMeasurement,
    type AudioQualitySeverity,
    type AudioStatsBaseline,
} from '@/lib/facilitator-audio-quality';
import { isLocalizedStaffRole } from '@/lib/i18n';

type Props = {
    room: Room | null;
    isStaff: boolean;
    isAssignedFacilitator: boolean;
};

const SEVERITY_ORDER: Record<AudioQualitySeverity, number> = {
    healthy: 1,
    waiting: 2,
    warning: 3,
    critical: 4,
};

function metadata(participant: Participant): { role: string | null; isAssignedFacilitator: boolean } {
    try {
        const value = JSON.parse(participant.metadata || '{}') as Record<string, unknown>;
        return {
            role: typeof value.role === 'string' ? value.role : null,
            isAssignedFacilitator: value.isAssignedFacilitator === true,
        };
    } catch {
        return { role: null, isAssignedFacilitator: false };
    }
}

function highestSeverity(values: AudioQualitySeverity[]): AudioQualitySeverity {
    if (!values.length || values.every((value) => value === 'waiting')) return 'waiting';
    return values.reduce((highest, value) => (
        SEVERITY_ORDER[value] > SEVERITY_ORDER[highest] ? value : highest
    ), values[0]);
}

function metric(value: number | undefined, suffix: string, unavailable: string): string {
    return value === undefined ? unavailable : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function MeasurementGrid({
    measurement,
    heading,
    unavailable,
    labels,
}: {
    measurement: AudioQualityMeasurement | null;
    heading: string;
    unavailable: string;
    labels: {
        bitrate: string;
        packetLoss: string;
        jitter: string;
        roundTripTime: string;
        concealment: string;
        availableBitrate: string;
        codec: string;
        capture: string;
    };
}) {
    const capture = measurement?.capture;
    const captureParts = capture ? [
        capture.sampleRateHz === undefined ? null : `${Math.round(capture.sampleRateHz / 1_000)} kHz`,
        capture.channelCount === undefined ? null : `${capture.channelCount} ch`,
        capture.autoGainControl === undefined ? null : `AGC ${capture.autoGainControl ? 'on' : 'off'}`,
        capture.echoCancellation === undefined ? null : `AEC ${capture.echoCancellation ? 'on' : 'off'}`,
        capture.noiseSuppression === undefined ? null : `NS ${capture.noiseSuppression ? 'on' : 'off'}`,
        capture.voiceIsolation === undefined ? null : `VI ${capture.voiceIsolation ? 'on' : 'off'}`,
    ].filter(Boolean).join(' · ') : unavailable;

    const items = [
        [labels.bitrate, metric(measurement?.bitrateKbps, ' kbps', unavailable)],
        [labels.packetLoss, metric(measurement?.packetLossPct, '%', unavailable)],
        [labels.jitter, metric(measurement?.jitterMs, ' ms', unavailable)],
        [labels.roundTripTime, metric(measurement?.roundTripTimeMs, ' ms', unavailable)],
        ...(measurement?.plane === 'downlink'
            ? [[labels.concealment, metric(measurement?.concealmentPct, '%', unavailable)]]
            : [[labels.availableBitrate, metric(measurement?.availableBitrateKbps, ' kbps', unavailable)]]),
        [labels.codec, measurement?.codec ?? unavailable],
        ...(measurement?.plane === 'uplink' ? [[labels.capture, captureParts]] : []),
    ];

    return (
        <section aria-label={heading}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--gold)]">{heading}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                {items.map(([label, value]) => (
                    <div key={label} className={label === labels.capture ? 'col-span-2 sm:col-span-3' : ''}>
                        <dt className="text-[var(--text-muted)]">{label}</dt>
                        <dd className="mt-0.5 break-words font-mono text-[var(--cream)]">{value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

/**
 * Staff-only, read-only quality monitor. It samples browser/LiveKit stats and
 * exchanges a small identity-free uplink snapshot. It deliberately has no
 * callback capable of muting, unpublishing, disconnecting, or changing tracks.
 */
export default function FacilitatorAudioQuality({ room, isStaff, isAssignedFacilitator }: Props) {
    const { copy } = useLocale();
    const [uplink, setUplink] = useState<AudioQualityMeasurement | null>(null);
    const [downlink, setDownlink] = useState<AudioQualityMeasurement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const uplinkBaseline = useRef<AudioStatsBaseline | undefined>(undefined);
    const downlinkBaseline = useRef<AudioStatsBaseline | undefined>(undefined);

    useEffect(() => {
        if (!room || !isStaff) return;
        const activeRoom = room;
        let cancelled = false;
        uplinkBaseline.current = undefined;
        downlinkBaseline.current = undefined;

        const receiveTelemetry = (
            payload: Uint8Array,
            participant?: Participant,
            _kind?: unknown,
            topic?: string,
        ) => {
            if (topic !== FACILITATOR_AUDIO_TELEMETRY_TOPIC || !participant) return;
            if (!metadata(participant).isAssignedFacilitator) return;
            const parsed = parseFacilitatorTelemetry(payload);
            // Sender and receiver wall clocks may differ. Freshness is based on
            // local arrival time, while every numeric value remains the sender's.
            if (parsed) setUplink({ ...parsed.measurement, sampledAt: Date.now() });
        };
        activeRoom.on(RoomEvent.DataReceived, receiveTelemetry);

        async function sample() {
            if (cancelled) return;
            const sampledAt = Date.now();
            setNow(sampledAt);

            if (isAssignedFacilitator) {
                const publication = activeRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
                const track = publication?.audioTrack;
                const report = await track?.getRTCStatsReport().catch(() => undefined);
                if (report && !cancelled) {
                    const result = measureAudioQuality(report, 'uplink', uplinkBaseline.current, {
                        sampledAt,
                        connectionQuality: String(activeRoom.localParticipant.connectionQuality),
                        captureSettings: track?.getSourceTrackSettings(),
                    });
                    if (result) {
                        uplinkBaseline.current = result.baseline;
                        setUplink(result.measurement);
                        const destinations = [...activeRoom.remoteParticipants.values()]
                            .filter((participant) => isLocalizedStaffRole(metadata(participant).role))
                            .map((participant) => participant.identity);
                        if (destinations.length) {
                            void activeRoom.localParticipant.publishData(
                                encodeFacilitatorTelemetry(result.measurement),
                                {
                                    reliable: false,
                                    topic: FACILITATOR_AUDIO_TELEMETRY_TOPIC,
                                    destinationIdentities: destinations,
                                },
                            ).catch(() => undefined);
                        }
                    }
                }
                setDownlink(null);
                return;
            }

            const facilitator = [...activeRoom.remoteParticipants.values()]
                .find((participant) => metadata(participant).isAssignedFacilitator);
            const publication = facilitator?.getTrackPublication(Track.Source.Microphone);
            const track = publication?.audioTrack;
            const report = await track?.getRTCStatsReport().catch(() => undefined);
            if (report && facilitator && !cancelled) {
                const result = measureAudioQuality(report, 'downlink', downlinkBaseline.current, {
                    sampledAt,
                    connectionQuality: String(facilitator.connectionQuality),
                });
                if (result) {
                    downlinkBaseline.current = result.baseline;
                    setDownlink(result.measurement);
                }
            }
        }

        void sample();
        const interval = window.setInterval(() => void sample(), FACILITATOR_AUDIO_SAMPLE_MS);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
            activeRoom.off(RoomEvent.DataReceived, receiveTelemetry);
        };
    }, [isAssignedFacilitator, isStaff, room]);

    const assessments = useMemo(() => [
        assessAudioQuality(uplink, now),
        ...(!isAssignedFacilitator ? [assessAudioQuality(downlink, now)] : []),
    ], [downlink, isAssignedFacilitator, now, uplink]);
    const severity = highestSeverity(assessments.map((assessment) => assessment.severity));
    const reasons = [...new Set(assessments.flatMap((assessment) => assessment.reasons))];
    const labels = copy.session.audioQuality;
    const measuredAt = Math.max(uplink?.sampledAt ?? 0, downlink?.sampledAt ?? 0);
    const ageSeconds = measuredAt ? Math.max(0, Math.round((now - measuredAt) / 1_000)) : null;
    const severityClass = {
        healthy: 'border-[var(--lime)]/45 bg-[var(--lime)]/10 text-[var(--lime)]',
        warning: 'border-[var(--warning)]/60 bg-[var(--warning)]/10 text-[var(--warning)]',
        critical: 'border-[var(--danger)]/70 bg-[var(--danger)]/10 text-[var(--danger)]',
        waiting: 'border-white/20 bg-white/5 text-[var(--text-secondary)]',
    }[severity];

    if (!isStaff) return null;

    return (
        <aside
            className={`w-full max-w-3xl rounded-lg border px-4 py-3 ${severityClass}`}
            data-testid="facilitator-audio-quality"
            data-severity={severity}
            aria-live={severity === 'critical' ? 'assertive' : 'polite'}
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-current">{labels.heading}</h2>
                <p className="font-mono text-xs">
                    {labels[severity]}
                    {ageSeconds === null ? '' : ` · ${labels.measuredAgo.replace('{seconds}', String(ageSeconds))}`}
                </p>
            </div>
            {reasons.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-current">
                    {reasons.map((reason) => <li key={reason}>{labels.reasons[reason] ?? reason}</li>)}
                </ul>
            ) : null}
            <details className="mt-3 text-[var(--text-secondary)]" open={severity === 'warning' || severity === 'critical'}>
                <summary className="cursor-pointer text-xs font-semibold text-[var(--cream)]">{labels.profile}</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <MeasurementGrid
                        measurement={uplink}
                        heading={labels.facilitatorUplink}
                        unavailable={labels.unavailable}
                        labels={labels}
                    />
                    {!isAssignedFacilitator ? (
                        <MeasurementGrid
                            measurement={downlink}
                            heading={labels.thisDeviceDownlink}
                            unavailable={labels.unavailable}
                            labels={labels}
                        />
                    ) : null}
                </div>
            </details>
        </aside>
    );
}
