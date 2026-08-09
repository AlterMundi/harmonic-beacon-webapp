import { describe, expect, it } from 'vitest';

import {
    LEGACY_LISTENER_POLICY_VERSION,
    legacyListenerPolicyCompatible,
} from '../access';

describe('Listener legacy policy rollback bridge', () => {
    it('accepts only the exact pre-cutover policy', () => {
        expect(legacyListenerPolicyCompatible(LEGACY_LISTENER_POLICY_VERSION)).toBe(true);
        expect(legacyListenerPolicyCompatible('personal-7-day-v1')).toBe(false);
        expect(legacyListenerPolicyCompatible(null)).toBe(false);
    });
});
