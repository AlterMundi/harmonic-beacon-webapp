export const ACCOUNT_MAINTENANCE_INTERVAL_MS = 15 * 60_000;

export type AccountMaintenanceState = {
    lastAttemptAt: number;
    failed: boolean;
};

export function initialAccountMaintenanceState(): AccountMaintenanceState {
    return { lastAttemptAt: 0, failed: false };
}

export function accountMaintenanceDue(state: AccountMaintenanceState, now: number): boolean {
    return state.lastAttemptAt === 0 || now - state.lastAttemptAt >= ACCOUNT_MAINTENANCE_INTERVAL_MS;
}

export function recordAccountMaintenanceAttempt(
    state: AccountMaintenanceState,
    now: number,
    succeeded: boolean,
): AccountMaintenanceState {
    return { ...state, lastAttemptAt: now, failed: !succeeded };
}

export function accountWorkerStatus(
    consecutiveMailErrors: number,
    maintenance: AccountMaintenanceState,
): 'ok' | 'degraded' | 'error' {
    if (consecutiveMailErrors >= 3) return 'error';
    if (consecutiveMailErrors > 0 || maintenance.failed) return 'degraded';
    return 'ok';
}
