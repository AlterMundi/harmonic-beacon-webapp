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
        expect(roomMixGains(0.8, 1)).toEqual({
            beacon: 0.8 * BEACON_SESSION_FLOOR_RATIO,
            session: 0.8,
        });
    });

    it('starts centered with the Beacon slightly above the session instead of too quiet', () => {
        expect(roomMixGains(0.8, 0.5)).toEqual({
            beacon: 0.5,
            session: 0.4,
        });
    });

    it('clamps hostile values and obeys master mute', () => {
        expect(roomMixGains(0, 0)).toEqual({ beacon: 0, session: 0 });
        expect(roomMixGains(2, -1)).toEqual({ beacon: 1, session: 0 });
        expect(roomMixGains(1, 2)).toEqual({
            beacon: BEACON_SESSION_FLOOR_RATIO,
            session: 1,
        });
    });
});
