import { describe, expect, it } from 'vitest';

import { BEACON_SESSION_FLOOR_RATIO, roomMixGains } from '../audio-mix';

describe('roomMixGains', () => {
    it('makes the Beacon end exclusive and full-strength under the master volume', () => {
        expect(roomMixGains(0.8, 0)).toEqual({
            beacon: 0.8,
            session: 0,
        });
    });

    it('retains the documented Beacon floor at the Session end', () => {
        const gains = roomMixGains(0.8, 1);
        expect(gains.beacon).toBeCloseTo(0.8 * BEACON_SESSION_FLOOR_RATIO);
        expect(gains.session).toBe(0.8);
    });

    it('starts centered with both sources near parity while preserving the session-side floor', () => {
        expect(roomMixGains(0.8, 0.5)).toEqual({
            beacon: 0.42000000000000004,
            session: 0.4,
        });
    });

    it('clamps hostile values and obeys master mute', () => {
        expect(roomMixGains(0, 0)).toEqual({ beacon: 0, session: 0 });
        expect(roomMixGains(2, -1)).toEqual({ beacon: 1, session: 0 });
        const sessionEnd = roomMixGains(1, 2);
        expect(sessionEnd.beacon).toBeCloseTo(BEACON_SESSION_FLOOR_RATIO);
        expect(sessionEnd.session).toBe(1);
    });
});
