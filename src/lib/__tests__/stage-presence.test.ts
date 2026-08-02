import { describe, expect, it } from 'vitest';

import { effectiveStageState } from '../stage-presence';

describe('effectiveStageState', () => {
    it.each([
        [{ hasActiveGrant: false, connected: true, publishedTrackCount: 2 }, 'AUDIENCE'],
        [{ hasActiveGrant: true, connected: null, publishedTrackCount: 0 }, 'UNKNOWN'],
        [{ hasActiveGrant: true, connected: false, publishedTrackCount: 1 }, 'RECONNECTING'],
        [{ hasActiveGrant: true, connected: true, publishedTrackCount: 0 }, 'INVITED'],
        [{ hasActiveGrant: true, connected: true, publishedTrackCount: 1 }, 'ON_STAGE'],
    ] as const)('maps %o to %s', (input, expected) => {
        expect(effectiveStageState(input)).toBe(expected);
    });
});
