import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    CommerceContractError,
    canonicalJson,
    commerceCommandHash,
    materialCommerceCommand,
    parseCommerceCommand,
} from '@/lib/commerce-contract';

const fixture = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'contracts/commerce-entitlement/v1/canonicalization.fixture.json'),
    'utf8',
)) as {
    input: Record<string, unknown>;
    canonical_utf8: string;
    sha256: string;
};

describe('commerce command contract', () => {
    it('normalizes then produces the cross-language RFC 8785 fixture and SHA-256', () => {
        const command = parseCommerceCommand(fixture.input);
        expect(command.bound_email).toBe('persóna+mito@example.com');
        expect(canonicalJson(materialCommerceCommand(command))).toBe(fixture.canonical_utf8);
        expect(commerceCommandHash(command)).toBe(fixture.sha256);
    });

    it('excludes request_id but includes every material field', () => {
        const first = parseCommerceCommand(fixture.input);
        const replay = parseCommerceCommand({
            ...fixture.input,
            request_id: '50000000-0000-4000-8000-000000000005',
        });
        const changed = parseCommerceCommand({
            ...fixture.input,
            external_order_id: 'tt-order-0002',
        });
        expect(commerceCommandHash(replay)).toBe(commerceCommandHash(first));
        expect(commerceCommandHash(changed)).not.toBe(commerceCommandHash(first));
    });

    it('rejects unknown fields and state/reason/grant mismatches', () => {
        const unknown = { ...fixture.input, surprise: true };
        expect(() => parseCommerceCommand(unknown)).toThrowError(CommerceContractError);

        expect(() => parseCommerceCommand({
            ...fixture.input,
            desired_provider_state: 'REVOKED',
            reason_code: 'PAYMENT_VERIFIED',
            grant: null,
        })).toThrow(/reason_code/);

        expect(() => parseCommerceCommand({
            ...fixture.input,
            desired_provider_state: 'REVOKED',
            reason_code: 'FULL_REFUND',
        })).toThrow(/grant must be null/);
    });

    it('requires canonical UTC milliseconds and safe integer-only canonical JSON', () => {
        expect(() => parseCommerceCommand({
            ...fixture.input,
            provider_observed_at: '2026-08-01T04:00:00Z',
        })).toThrow(/canonical UTC/);
        expect(() => canonicalJson({ value: 1.5 })).toThrow(/safe integers/);
        expect(() => parseCommerceCommand({
            ...fixture.input,
            bound_email: `person\ud800@example.com`,
        })).toThrow(/invalid Unicode/);
    });

    it('parses a revoked tombstone without credential material', () => {
        const command = parseCommerceCommand({
            ...fixture.input,
            provision_revision: 8,
            desired_provider_state: 'REVOKED',
            reason_code: 'TICKET_VOIDED',
            grant: null,
        });
        expect(command.grant).toBeNull();
    });
});
