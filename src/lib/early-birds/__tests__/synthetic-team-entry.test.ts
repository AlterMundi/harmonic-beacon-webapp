import { describe, expect, it } from 'vitest';

import { syntheticTeamEntryAllowed } from '../synthetic-team-entry';

const environment = {
    NODE_ENV: 'production',
    EARLY_BIRDS_ENABLED: '1',
    EARLY_BIRDS_TEST_ACCESS_ENABLED: '1',
    EARLY_BIRDS_TEST_LOGIN_SECRET: 's'.repeat(32),
    EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: '1',
    EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS: 'earlybirds-staging.example.test',
} as NodeJS.ProcessEnv;

function allowed(overrides: Record<string, string> = {}, headers: HeadersInit = {}) {
    return syntheticTeamEntryAllowed({
        headers: new Headers({
            host: 'earlybirds-staging.example.test',
            'x-forwarded-proto': 'https',
            ...headers,
        }),
    }, { ...environment, ...overrides } as NodeJS.ProcessEnv);
}

describe('EarlyBird synthetic team entry staging gate', () => {
    it('opens only with every explicit production staging condition', () => {
        expect(allowed()).toBe(true);
        expect(allowed({ EARLY_BIRDS_ENABLED: '0' })).toBe(false);
        expect(allowed({ EARLY_BIRDS_TEST_ACCESS_ENABLED: '0' })).toBe(false);
        expect(allowed({ EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: '0' })).toBe(false);
        expect(allowed({ EARLY_BIRDS_TEST_LOGIN_SECRET: 'short' })).toBe(false);
        expect(allowed({ NODE_ENV: 'test' })).toBe(false);
    });

    it('requires HTTPS and an exact host match', () => {
        expect(allowed({}, { 'x-forwarded-proto': 'http' })).toBe(false);
        expect(allowed({}, { 'x-forwarded-proto': 'https,http' })).toBe(false);
        expect(allowed({}, { host: 'sub.earlybirds-staging.example.test' })).toBe(false);
        expect(allowed({}, { host: 'earlybirds-staging.example.test.evil.test' })).toBe(false);
    });

    it('fails closed for wildcard, origin-shaped or partially invalid allowlists', () => {
        expect(allowed({ EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS: '*.example.test' })).toBe(false);
        expect(allowed({
            EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS: 'https://earlybirds-staging.example.test',
        })).toBe(false);
        expect(allowed({
            EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS: 'earlybirds-staging.example.test,bad/value',
        })).toBe(false);
    });
});
