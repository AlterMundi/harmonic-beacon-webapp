/**
 * Presentation-only adapter for the Listener weekly quota contract.
 *
 * The access endpoint remains the authority. Keeping its wire shape at this
 * boundary makes the client deliberately conservative while the canonical
 * backend is rolling out: unknown or incomplete fields never manufacture
 * access, and only a newer server timestamp may replace a snapshot.
 */
export type ListenerQuotaStatus = 'not-started' | 'available' | 'listening' | 'exhausted';

export type SerializedEarlyBirdQuotaSnapshot = {
    policy: 'personal-7-day-v1';
    status: ListenerQuotaStatus;
    cycleStartedAt: string | null;
    cycleEndsAt: string | null;
    baseAllowanceMs: number;
    bonusAllowanceMs: number;
    consumedMs: number;
    remainingMs: number;
    activelyConsuming: boolean;
    exhaustsAt: string | null;
    nextCycleAt: string | null;
};

export type ListenerQuotaSnapshot = SerializedEarlyBirdQuotaSnapshot & { serverNow: string };

const WEEKLY_FREE_MS = 3 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

function finiteMilliseconds(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : null;
}

function isoDate(value: unknown): string | null {
    return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value))
        ? value
        : null;
}

export function listenerQuotaSnapshot(
    value: SerializedEarlyBirdQuotaSnapshot | null | undefined,
    fallbackServerNow: string,
): ListenerQuotaSnapshot | null {
    if (!value || value.policy !== 'personal-7-day-v1' || !isoDate(fallbackServerNow)) return null;
    const numbers = [
        value.baseAllowanceMs,
        value.bonusAllowanceMs,
        value.consumedMs,
        value.remainingMs,
    ].map(finiteMilliseconds);
    if (numbers.some((number) => number === null)) return null;
    if (value.status !== 'not-started' && value.status !== 'available' && value.status !== 'listening' && value.status !== 'exhausted') return null;
    if ((value.cycleStartedAt !== null && !isoDate(value.cycleStartedAt))
        || (value.cycleEndsAt !== null && !isoDate(value.cycleEndsAt))
        || (value.exhaustsAt !== null && !isoDate(value.exhaustsAt))
        || (value.nextCycleAt !== null && !isoDate(value.nextCycleAt))) return null;

    return {
        ...value,
        baseAllowanceMs: numbers[0]!,
        bonusAllowanceMs: numbers[1]!,
        consumedMs: numbers[2]!,
        remainingMs: numbers[3]!,
        serverNow: fallbackServerNow,
    };
}

export function quotaSnapshotFromAccessState(payload: unknown): ListenerQuotaSnapshot | null {
    if (!payload || typeof payload !== 'object') return null;
    const root = payload as Record<string, unknown>;
    const access = root.access && typeof root.access === 'object'
        ? root.access as Record<string, unknown>
        : null;
    if (!access) return null;
    return listenerQuotaSnapshot(
        access.quota as SerializedEarlyBirdQuotaSnapshot | null | undefined,
        typeof root.serverNow === 'string' ? root.serverNow : '',
    );
}

export function isNewerQuotaSnapshot(
    next: ListenerQuotaSnapshot,
    current: ListenerQuotaSnapshot,
) {
    return Date.parse(next.serverNow) > Date.parse(current.serverNow);
}

export function formatQuotaDuration(milliseconds: number, locale: 'es' | 'en') {
    const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours === 0) return locale === 'es' ? `${remainder} min` : `${remainder}m`;
    if (remainder === 0) return locale === 'es' ? `${hours} h` : `${hours}h`;
    return locale === 'es' ? `${hours} h ${remainder} min` : `${hours}h ${remainder}m`;
}

export function formatQuotaRenewalDuration(milliseconds: number, locale: 'es' | 'en') {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
    if (totalMinutes < 60) return locale === 'es' ? `${totalMinutes} min` : `${totalMinutes}m`;

    const totalHours = Math.ceil(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days === 0) return locale === 'es' ? `${hours} h` : `${hours}h`;
    if (hours === 0) return locale === 'es' ? `${days} d` : `${days}d`;
    return locale === 'es' ? `${days} d ${hours} h` : `${days}d ${hours}h`;
}

export const LISTENER_WEEKLY_FREE_MS = WEEKLY_FREE_MS;
