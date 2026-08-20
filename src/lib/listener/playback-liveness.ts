export const LISTENER_PLAYBACK_WATCHDOG_INTERVAL_MS = 5_000;
export const LISTENER_PLAYBACK_STALL_AFTER_MS = 15_000;
export const LISTENER_PLAYBACK_EXHAUSTED_STALL_AFTER_MS = 5_000;

const MEDIA_PROGRESS_EPSILON_SECONDS = 0.05;

export type ListenerPlaybackStallReason =
    | 'media-error'
    | 'paused-unexpectedly'
    | 'ended-unexpectedly'
    | 'media-clock-stalled';

export type ListenerPlaybackDiagnostic = {
    schemaVersion: 1;
    reason: ListenerPlaybackStallReason;
    transport: 'beacon';
    lastAction: string;
    observedAtMs: number;
    stalledForMs: number;
    media: {
        currentTimeSeconds: number;
        paused: boolean;
        ended: boolean;
        readyState: number;
        networkState: number;
        muted: boolean;
        volume: number;
        playbackRate: number;
        errorCode: number | null;
        bufferedRangeCount: number;
        bufferedEndSeconds: number | null;
        bufferedAheadSeconds: number;
        seekableRangeCount: number;
        seekableEndSeconds: number | null;
    };
    lease: {
        generation: number | null;
        presenceSequence: number;
    };
    hls: {
        type: string | null;
        details: string | null;
        fatal: boolean | null;
    };
    visibility: DocumentVisibilityState;
};

type LivenessObservation = Omit<ListenerPlaybackDiagnostic, 'schemaVersion' | 'reason' | 'stalledForMs'>;

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function lastRangeEnd(ranges: TimeRanges): number | null {
    if (ranges.length < 1) return null;
    try {
        const value = ranges.end(ranges.length - 1);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

function bufferedAheadSeconds(ranges: TimeRanges, currentTimeSeconds: number): number {
    for (let index = 0; index < ranges.length; index += 1) {
        try {
            const start = ranges.start(index);
            const end = ranges.end(index);
            if (
                Number.isFinite(start)
                && Number.isFinite(end)
                && currentTimeSeconds >= start - 0.25
                && currentTimeSeconds <= end + 0.25
            ) return Math.max(0, end - currentTimeSeconds);
        } catch {
            return 0;
        }
    }
    return 0;
}

/**
 * Process-local media clock observer. It stores no identity, URL, token,
 * account or raw browser metadata and never changes the audio graph.
 */
export class ListenerPlaybackLivenessWatchdog {
    private lastMediaTimeSeconds: number | null = null;
    private lastProgressAtMs: number | null = null;

    reset(): void {
        this.lastMediaTimeSeconds = null;
        this.lastProgressAtMs = null;
    }

    observe(input: LivenessObservation): ListenerPlaybackDiagnostic | null {
        const currentTimeSeconds = finiteOr(input.media.currentTimeSeconds, 0);
        const observedAtMs = finiteOr(input.observedAtMs, 0);
        const previousTime = this.lastMediaTimeSeconds;
        const progressed = previousTime === null
            || Math.abs(currentTimeSeconds - previousTime) >= MEDIA_PROGRESS_EPSILON_SECONDS;

        if (progressed) {
            this.lastMediaTimeSeconds = currentTimeSeconds;
            this.lastProgressAtMs = observedAtMs;
            return null;
        }

        if (this.lastProgressAtMs === null) this.lastProgressAtMs = observedAtMs;
        const stalledForMs = Math.max(0, observedAtMs - this.lastProgressAtMs);
        const exhaustedAfterNetworkFailure = input.media.bufferedAheadSeconds <= 0.25
            && input.hls.fatal === true
            && input.hls.type === 'networkError';
        const stallAfterMs = exhaustedAfterNetworkFailure
            ? LISTENER_PLAYBACK_EXHAUSTED_STALL_AFTER_MS
            : LISTENER_PLAYBACK_STALL_AFTER_MS;
        const reason: ListenerPlaybackStallReason | null = input.media.errorCode !== null
            ? 'media-error'
            : stalledForMs < stallAfterMs
                ? null
                : input.media.paused
                    ? 'paused-unexpectedly'
                    : input.media.ended
                        ? 'ended-unexpectedly'
                        : 'media-clock-stalled';

        if (!reason) return null;
        return {
            schemaVersion: 1,
            ...input,
            reason,
            stalledForMs,
            media: { ...input.media, currentTimeSeconds },
        };
    }
}

export function listenerPlaybackObservation({
    audio,
    observedAtMs,
    lastAction,
    leaseGeneration,
    presenceSequence,
    hlsSignal,
    visibility,
}: {
    audio: HTMLMediaElement;
    observedAtMs: number;
    lastAction: string;
    leaseGeneration: number | null;
    presenceSequence: number;
    hlsSignal: { type: string | null; details: string | null; fatal: boolean | null };
    visibility: DocumentVisibilityState;
}): LivenessObservation {
    const currentTimeSeconds = finiteOr(audio.currentTime, 0);
    return {
        transport: 'beacon',
        lastAction: lastAction.slice(0, 48),
        observedAtMs,
        media: {
            currentTimeSeconds,
            paused: audio.paused,
            ended: audio.ended,
            readyState: audio.readyState,
            networkState: audio.networkState,
            muted: audio.muted,
            volume: finiteOr(audio.volume, 0),
            playbackRate: finiteOr(audio.playbackRate, 1),
            errorCode: audio.error?.code ?? null,
            bufferedRangeCount: audio.buffered.length,
            bufferedEndSeconds: lastRangeEnd(audio.buffered),
            bufferedAheadSeconds: bufferedAheadSeconds(audio.buffered, currentTimeSeconds),
            seekableRangeCount: audio.seekable.length,
            seekableEndSeconds: lastRangeEnd(audio.seekable),
        },
        lease: {
            generation: leaseGeneration,
            presenceSequence,
        },
        hls: { ...hlsSignal },
        visibility,
    };
}
