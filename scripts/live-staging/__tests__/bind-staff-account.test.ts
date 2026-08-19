import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    INPUT_PATH,
    STAGING_ACCOUNT_ISSUER,
    parseBindingInput,
    readRootOnlyBindingInput,
    validateStagingEnvironment,
} from '../bind-staff-account';

const validInput = [
    `ACCOUNT_ISSUER=${STAGING_ACCOUNT_ISSUER}`,
    'ACCOUNT_SUBJECT=opaque_subject:staging-123',
    'STAFF_USER_ID=123e4567-e89b-42d3-a456-426614174000',
].join('\n');

describe('Live staging staff Account binding guardrails', () => {
    it('parses only the exact non-email authority contract', () => {
        expect(parseBindingInput(validInput)).toEqual({
            accountIssuer: STAGING_ACCOUNT_ISSUER,
            accountSubject: 'opaque_subject:staging-123',
            staffUserId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(() => parseBindingInput(`${validInput}\nEMAIL=operator@example.com`)).toThrow(/exactly/);
        expect(() => parseBindingInput(validInput.replace('opaque_subject:staging-123', 'contains whitespace'))).toThrow(/opaque/);
        expect(() => parseBindingInput(validInput.replace(STAGING_ACCOUNT_ISSUER, 'https://account.harmonicbeacon.com'))).toThrow(/staging issuer/);
    });

    it('is default-off and accepts only the isolated staging database', () => {
        expect(() => validateStagingEnvironment({
            LIVE_STAGING_ENVIRONMENT: 'live-staging',
            DATABASE_URL: 'postgresql://unused@postgres/beacon_live_staging',
        })).toThrow(/disabled/);
        expect(() => validateStagingEnvironment({
            LIVE_STAGING_STAFF_BINDING_ENABLED: '1',
            LIVE_STAGING_ENVIRONMENT: 'live-staging',
            DATABASE_URL: 'postgresql://unused@postgres/beacon',
        })).toThrow(/other than/);
        expect(validateStagingEnvironment({
            LIVE_STAGING_STAFF_BINDING_ENABLED: '1',
            LIVE_STAGING_ENVIRONMENT: 'live-staging',
            DATABASE_URL: 'postgresql://unused@postgres/beacon_live_staging',
        }).pathname).toBe('/beacon_live_staging');
    });

    it('does not permit an operator-selected input path', async () => {
        await expect(readRootOnlyBindingInput('/tmp/operator-selected.env')).rejects.toThrow(/fixed/);
        expect(INPUT_PATH).toBe('/run/harmonic-beacon/staff-account-binding.env');
    });

    it('has no code path to sessions, tickets, events or email matching', async () => {
        const source = await readFile(new URL('../bind-staff-account.ts', import.meta.url), 'utf8');
        for (const forbidden of ['webSession.', 'ticketEntitlement.', 'scheduledSession.', 'email:']) {
            expect(source).not.toContain(forbidden);
        }
    });
});
