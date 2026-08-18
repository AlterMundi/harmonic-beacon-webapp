import { describe, expect, it } from 'vitest';

import {
    ACCOUNT_MAINTENANCE_INTERVAL_MS,
    accountMaintenanceDue,
    accountWorkerStatus,
    initialAccountMaintenanceState,
    recordAccountMaintenanceAttempt,
} from '../worker-health';

describe('Account worker maintenance health', () => {
    it('stays degraded between a failed cleanup and the next successful scheduled attempt', () => {
        const startedAt = Date.parse('2026-08-18T00:00:00.000Z');
        let state = initialAccountMaintenanceState();
        expect(accountMaintenanceDue(state, startedAt)).toBe(true);

        state = recordAccountMaintenanceAttempt(state, startedAt, false);
        expect(accountWorkerStatus(0, state)).toBe('degraded');
        expect(accountMaintenanceDue(state, startedAt + 5_000)).toBe(false);
        expect(accountWorkerStatus(0, state)).toBe('degraded');
        expect(accountMaintenanceDue(state, startedAt + ACCOUNT_MAINTENANCE_INTERVAL_MS - 1)).toBe(false);

        const retryAt = startedAt + ACCOUNT_MAINTENANCE_INTERVAL_MS;
        expect(accountMaintenanceDue(state, retryAt)).toBe(true);
        state = recordAccountMaintenanceAttempt(state, retryAt, true);
        expect(accountWorkerStatus(0, state)).toBe('ok');
    });
});
