import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    AUDIT_REASON,
    INPUT_PATH,
    PRODUCTION_ACCOUNT_ISSUER,
    parseBindingInput,
    readRootOnlyBindingInput,
    validateProductionEnvironment,
} from '../bind-staff-account';

const validInput = [
    `ACCOUNT_ISSUER=${PRODUCTION_ACCOUNT_ISSUER}`,
    'ACCOUNT_SUBJECT=opaque_subject:production-123',
    'STAFF_USER_ID=123e4567-e89b-42d3-a456-426614174000',
].join('\n');

describe('Live production staff Account binding guardrails', () => {
    it('accepts only the production issuer and non-email fixed input contract', () => {
        expect(parseBindingInput(validInput)).toEqual({
            accountIssuer: PRODUCTION_ACCOUNT_ISSUER,
            accountSubject: 'opaque_subject:production-123',
            staffUserId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(() => parseBindingInput(`${validInput}\nEMAIL=operator@example.com`)).toThrow(/exactly/);
        expect(() => parseBindingInput(validInput.replace('opaque_subject:production-123', 'contains whitespace')))
            .toThrow(/opaque/);
        expect(() => parseBindingInput(validInput.replace(PRODUCTION_ACCOUNT_ISSUER,
            'https://account-staging.harmonicbeacon.com'))).toThrow(/production issuer/);
    });

    it('is default-off and requires every production marker', () => {
        const complete = {
            LIVE_PRODUCTION_STAFF_BINDING_ENABLED: '1',
            LIVE_PRODUCTION_ENVIRONMENT: 'production',
            BEACON_ACCOUNT_ISSUER_URL: PRODUCTION_ACCOUNT_ISSUER,
            DATABASE_URL: 'postgresql://unused@postgres/beacon',
        };
        expect(() => validateProductionEnvironment({ ...complete, LIVE_PRODUCTION_STAFF_BINDING_ENABLED: undefined }))
            .toThrow(/disabled/);
        expect(() => validateProductionEnvironment({ ...complete, LIVE_PRODUCTION_ENVIRONMENT: 'live-staging' }))
            .toThrow(/environment marker/);
        expect(() => validateProductionEnvironment({ ...complete, BEACON_ACCOUNT_ISSUER_URL:
            'https://account-staging.harmonicbeacon.com' })).toThrow(/issuer marker/);
        expect(() => validateProductionEnvironment({ ...complete,
            DATABASE_URL: 'postgresql://unused@postgres/beacon_live_staging' })).toThrow(/other than beacon/);
        expect(validateProductionEnvironment(complete).pathname).toBe('/beacon');
    });

    it('does not permit an operator-selected input path', async () => {
        await expect(readRootOnlyBindingInput('/tmp/operator-selected.env')).rejects.toThrow(/fixed/);
        expect(INPUT_PATH).toBe('/run/harmonic-beacon/staff-account-binding.env');
        expect(AUDIT_REASON).toBe('live_production_operator_provision');
    });

    it('has no path to sessions, tickets, events, email matching or provider APIs', async () => {
        const source = await readFile(new URL('../bind-staff-account.ts', import.meta.url), 'utf8');
        for (const forbidden of [
            'webSession.', 'ticketEntitlement.', 'scheduledSession.', 'email:',
            'fetch(', 'paypal', 'mercadopago', 'LIVEKIT_API_SECRET',
        ]) {
            expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
        }
    });
});
