import { describe, expect, it } from 'vitest';

import { accountAccessMethodFromProviderIds } from '../auth';

describe('accountAccessMethodFromProviderIds', () => {
    it.each([
        [['credential'], 'email'],
        [['google'], 'google'],
        [['apple'], 'apple'],
    ] as const)('maps the single durable provider %j', (providers, expected) => {
        expect(accountAccessMethodFromProviderIds(providers)).toBe(expected);
    });

    it.each([
        [[]],
        [['unknown']],
        [['google', 'credential']],
    ] as const)('fails closed for an absent, unknown or ambiguous provider set %j', (providers) => {
        expect(accountAccessMethodFromProviderIds(providers)).toBeNull();
    });
});
