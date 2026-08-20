export const LISTENER_BUFFER_TARGET_SECONDS = 180;
export const LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS = 0.25;
export const LISTENER_RECOVERY_BACKOFF_MS = [
    0,
    1_000,
    2_000,
    4_000,
    8_000,
    15_000,
    30_000,
] as const;

export type ListenerHlsRecoveryAction =
    | 'restart-network-load'
    | 'recover-media'
    | 'rebuild-pipeline';

export type ListenerTransportDiagnostic = {
    schemaVersion: 1;
    reason: 'hls-fatal' | 'hls-recovered' | 'reservoir-ready';
    transport: 'beacon';
    action: ListenerHlsRecoveryAction | 'refill-resumed' | 'reservoir-filled';
    observedAtMs: number;
    bufferedAheadSeconds: number;
    reservoirAheadSeconds: number;
    recoveryAttempt: number;
    hls: {
        type: string | null;
        details: string | null;
    };
};

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function boundedTransportLabel(value: string | null): string | null {
    if (value === null || !/^[A-Za-z0-9_-]{1,48}$/.test(value)) return null;
    return value;
}

/**
 * Returns only media that is playable continuously from the current clock.
 * A later disconnected range is not useful during a network interruption.
 */
export function listenerBufferedAheadSeconds(
    media: Pick<HTMLMediaElement, 'currentTime' | 'buffered'>,
): number {
    const currentTime = finiteOrZero(media.currentTime);
    for (let index = 0; index < media.buffered.length; index += 1) {
        try {
            const start = media.buffered.start(index);
            const end = media.buffered.end(index);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            if (
                currentTime >= start - LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS
                && currentTime <= end + LISTENER_BUFFER_EXHAUSTED_EPSILON_SECONDS
            ) {
                return Math.max(0, end - currentTime);
            }
        } catch {
            return 0;
        }
    }
    return 0;
}

export function listenerRecoveryDelayMs(attempt: number): number {
    const normalized = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 0;
    return LISTENER_RECOVERY_BACKOFF_MS[
        Math.min(normalized, LISTENER_RECOVERY_BACKOFF_MS.length - 1)
    ];
}

export function listenerHlsRecoveryAction(errorType: unknown): ListenerHlsRecoveryAction {
    if (errorType === 'networkError') return 'restart-network-load';
    if (errorType === 'mediaError') return 'recover-media';
    return 'rebuild-pipeline';
}

export function listenerTransportDiagnostic(input: {
    reason: ListenerTransportDiagnostic['reason'];
    action: ListenerTransportDiagnostic['action'];
    observedAtMs: number;
    bufferedAheadSeconds: number;
    recoveryAttempt: number;
    hlsType: string | null;
    hlsDetails: string | null;
    reservoirAheadSeconds?: number;
}): ListenerTransportDiagnostic {
    return {
        schemaVersion: 1,
        reason: input.reason,
        transport: 'beacon',
        action: input.action,
        observedAtMs: finiteOrZero(input.observedAtMs),
        bufferedAheadSeconds: Math.max(0, finiteOrZero(input.bufferedAheadSeconds)),
        reservoirAheadSeconds: Math.max(0, finiteOrZero(input.reservoirAheadSeconds ?? 0)),
        recoveryAttempt: Number.isSafeInteger(input.recoveryAttempt) && input.recoveryAttempt > 0
            ? input.recoveryAttempt
            : 0,
        hls: {
            type: boundedTransportLabel(input.hlsType),
            details: boundedTransportLabel(input.hlsDetails),
        },
    };
}
