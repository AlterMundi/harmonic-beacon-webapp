import { describe, expect, it } from 'vitest';
import { measuredPresenceSeconds } from '../profile-time';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 10, minutes));
describe('measured personal presence', () => {
    it('unions simultaneous rooms/devices without counting reconnect gaps', () => {
        expect(measuredPresenceSeconds([
            { startedAt: at(0), lastHeartbeatAt: at(10), endedAt: at(10) },
            { startedAt: at(5), lastHeartbeatAt: at(15), endedAt: at(15) },
            { startedAt: at(20), lastHeartbeatAt: at(25), endedAt: at(25) },
        ], at(30))).toBe(20 * 60);
    });
    it('does not count an offline gap even if an operator closes the event later', () => {
        expect(measuredPresenceSeconds([{ startedAt: at(0), lastHeartbeatAt: at(5), endedAt: at(59) }], at(59))).toBe(345);
    });
    it('bounds open intervals by now and the last server observation', () => {
        expect(measuredPresenceSeconds([{ startedAt: at(0), lastHeartbeatAt: at(5), endedAt: null }], at(10))).toBe(345);
        expect(measuredPresenceSeconds([{ startedAt: at(0), lastHeartbeatAt: at(5), endedAt: null }], at(5))).toBe(300);
    });
    it('ignores invalid and inverted records', () => {
        expect(measuredPresenceSeconds([{ startedAt: at(10), lastHeartbeatAt: at(5), endedAt: at(5) }], at(20))).toBe(0);
    });
});
