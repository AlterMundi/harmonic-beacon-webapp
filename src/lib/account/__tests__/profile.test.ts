import { describe, expect, it } from 'vitest';

import { normalizeBeaconDisplayName } from '@/lib/account/profile';

describe('provider-independent Beacon display name normalization', () => {
    it('normalizes ordinary whitespace but rejects invisible/control/bidi names', () => {
        expect(normalizeBeaconDisplayName('  Beacon   Listener  ')).toBe('Beacon Listener');
        for (const value of [
            '\u0000Hidden', 'zero\u200Bwidth', '\u202ERight-to-left override',
            '\u2066isolate', '\uFEFFbom', '\u00ADsoft-hyphen',
        ]) expect(normalizeBeaconDisplayName(value)).toBeNull();
    });
});
