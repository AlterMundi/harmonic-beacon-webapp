import { describe, expect, it } from 'vitest';

import { authorizeEarlyBirdMembershipService } from '../service-auth';

const current = 'a'.repeat(43);
const previous = 'b'.repeat(43);
const env = {
    NODE_ENV: 'test',
    EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID: 'current',
    EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT: current,
    EARLY_BIRDS_BEACON_SERVICE_KEY_PREVIOUS_ID: 'previous',
    EARLY_BIRDS_BEACON_SERVICE_KEY_PREVIOUS: previous,
} as NodeJS.ProcessEnv;

describe('EarlyBird membership service authentication', () => {
    it('accepts the current and previous key while binding token to key id', () => {
        expect(authorizeEarlyBirdMembershipService(`Bearer ${current}`, 'current', env)).toBe(true);
        expect(authorizeEarlyBirdMembershipService(`Bearer ${previous}`, 'previous', env)).toBe(true);
        expect(authorizeEarlyBirdMembershipService(`Bearer ${current}`, 'previous', env)).toBe(false);
    });

    it('fails closed for malformed or short configuration', () => {
        expect(authorizeEarlyBirdMembershipService(null, null, env)).toBe(false);
        expect(authorizeEarlyBirdMembershipService('Basic nope', 'current', env)).toBe(false);
        expect(authorizeEarlyBirdMembershipService('Bearer short', 'current', {
            NODE_ENV: 'test',
            EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID: 'current',
            EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT: 'short',
        } as NodeJS.ProcessEnv)).toBe(false);
    });
});
