import { describe, expect, it } from 'vitest';

import { configuredEarlyBirdDropIn } from '@/lib/early-birds/drop-ins';

describe('EarlyBird private drop-in configuration', () => {
    it('exposes only the authenticated same-origin route for an absolute local path', () => {
        expect(configuredEarlyBirdDropIn('es', {
            EARLY_BIRDS_DROPIN_ES_PATH: '/srv/early-birds/reviewed-es.m4a',
        })).toBe('/api/early-birds/drop-ins/es');
    });

    it('fails closed for missing and relative local paths', () => {
        expect(configuredEarlyBirdDropIn('en', {})).toBeNull();
        expect(configuredEarlyBirdDropIn('en', {
            EARLY_BIRDS_DROPIN_EN_PATH: 'reviewed-en.m4a',
        })).toBeNull();
    });

    it('ignores the retired arbitrary external URL fallback', () => {
        expect(configuredEarlyBirdDropIn('es', {
            EARLY_BIRDS_DROPIN_ES_URL: 'https://media.example.test/reviewed-es.m4a',
        })).toBeNull();
    });
});
