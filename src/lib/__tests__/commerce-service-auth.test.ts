import { describe, expect, it } from 'vitest';

import { authorizeCommerceService } from '@/lib/commerce-service-auth';

const tokenA = 'a'.repeat(43);
const tokenB = 'b'.repeat(43);
const env = {
    NODE_ENV: 'test',
    BEACON_COMMERCE_SERVICE_KEY_CURRENT_ID: '2026-08-current',
    BEACON_COMMERCE_SERVICE_KEY_CURRENT: tokenA,
    BEACON_COMMERCE_SERVICE_KEY_PREVIOUS_ID: '2026-07-previous',
    BEACON_COMMERCE_SERVICE_KEY_PREVIOUS: tokenB,
} as NodeJS.ProcessEnv;

describe('commerce service authentication', () => {
    it('accepts current and previous key during rotation', () => {
        expect(authorizeCommerceService(`Bearer ${tokenA}`, '2026-08-current', env)).toBe(true);
        expect(authorizeCommerceService(`Bearer ${tokenB}`, '2026-07-previous', env)).toBe(true);
    });

    it('binds the token to its non-secret key id', () => {
        expect(authorizeCommerceService(`Bearer ${tokenA}`, '2026-07-previous', env)).toBe(false);
        expect(authorizeCommerceService(`Bearer ${tokenB}`, '2026-08-current', env)).toBe(false);
    });

    it('fails closed for missing, short or malformed configuration', () => {
        expect(authorizeCommerceService(null, null, env)).toBe(false);
        expect(authorizeCommerceService('Basic nope', '2026-08-current', env)).toBe(false);
        expect(authorizeCommerceService('Bearer short', 'current', {
            NODE_ENV: 'test',
            BEACON_COMMERCE_SERVICE_KEY_CURRENT_ID: 'current',
            BEACON_COMMERCE_SERVICE_KEY_CURRENT: 'short',
        } as NodeJS.ProcessEnv)).toBe(false);
    });
});
