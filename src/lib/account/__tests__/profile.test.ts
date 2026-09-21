import { describe, expect, it } from 'vitest';

import { isBeaconProfileComplete, normalizeBeaconDisplayName, normalizeBeaconRealName } from '@/lib/account/profile';

describe('provider-independent Beacon display name normalization', () => {
    it('normalizes ordinary whitespace but rejects invisible/control/bidi names', () => {
        expect(normalizeBeaconDisplayName('  Beacon   Listener  ')).toBe('Beacon Listener');
        for (const value of [
            '\u0000Hidden', 'zero\u200Bwidth', '\u202ERight-to-left override',
            '\u2066isolate', '\uFEFFbom', '\u00ADsoft-hyphen',
        ]) expect(normalizeBeaconDisplayName(value)).toBeNull();
    });
});

describe('required private and preferred names', () => {
    it('accepts international and single-word names, including equal names', () => {
        for (const name of ['Nicolás', '李', 'أحمد', 'किरण', 'Zoë']) {
            expect(normalizeBeaconRealName(name)).toBe(name);
            expect(isBeaconProfileComplete({ displayName: name, realName: name })).toBe(true);
        }
        expect(isBeaconProfileComplete({ displayName: 'Nico', realName: 'Nicolás Echániz' })).toBe(true);
    });

    it('does not infer missing private names from existing public names', () => {
        expect(isBeaconProfileComplete({ displayName: 'Existing alias' })).toBe(false);
        expect(isBeaconProfileComplete(null)).toBe(false);
        for (const value of [undefined, null, 42, '', '   ', '\u00a0', 'x'.repeat(121), 'x\u202ey']) {
            expect(normalizeBeaconRealName(value)).toBeNull();
        }
        expect(normalizeBeaconRealName('  María   José ')).toBe('María José');
        expect(normalizeBeaconRealName('x'.repeat(120))).toHaveLength(120);
        expect(isBeaconProfileComplete({ displayName: ' ', realName: 'Valid' })).toBe(false);
    });
});
