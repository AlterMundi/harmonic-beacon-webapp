import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';

describe('EarlyBird public kill switch', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('fails closed when the setting is absent or ambiguous', () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '');
        expect(earlyBirdsEnabled()).toBe(false);

        for (const value of ['true', 'yes', '0', ' 1 ']) {
            vi.stubEnv('EARLY_BIRDS_ENABLED', value);
            expect(earlyBirdsEnabled()).toBe(false);
        }
    });

    it('enables public entry only for the explicit value 1', () => {
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        expect(earlyBirdsEnabled()).toBe(true);
    });

    it('prefers the canonical gate and fails closed when aliases disagree', () => {
        expect(earlyBirdsEnabled({
            BEACON_LISTENER_ENABLED: '1',
        } as unknown as NodeJS.ProcessEnv)).toBe(true);
        expect(earlyBirdsEnabled({
            BEACON_LISTENER_ENABLED: '1',
            EARLY_BIRDS_ENABLED: '0',
        } as unknown as NodeJS.ProcessEnv)).toBe(false);
    });

    it('enables the Free for All override only for the explicit value 1', () => {
        for (const value of ['', 'true', 'yes', '0', ' 1 ']) {
            vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', value);
            expect(earlyBirdsFreeForAll()).toBe(false);
        }
        vi.stubEnv('EARLY_BIRDS_FREE_FOR_ALL', '1');
        expect(earlyBirdsFreeForAll()).toBe(true);
    });

    it('returns a non-cacheable, retryable unavailable response', async () => {
        const response = earlyBirdsUnavailableResponse();

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('retry-after')).toBe('300');
        await expect(response.json()).resolves.toEqual({
            error: 'EarlyBirds is temporarily unavailable.',
        });
    });
});
