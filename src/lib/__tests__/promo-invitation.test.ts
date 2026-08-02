import { describe, expect, it } from 'vitest';

import {
    digestPromoCode,
    isPlausiblePromoCode,
    normalizePromoCode,
    promoInvitationsEnabled,
    promoRedeemerDigest,
} from '../promo-invitation';

const PEPPER = 'promo-test-pepper-with-at-least-32-characters';

describe('promotion invitation primitives', () => {
    it('normalizes human codes without accepting ambiguous punctuation or unsafe lengths', () => {
        expect(normalizePromoCode('  nico100 ')).toBe('NICO100');
        expect(isPlausiblePromoCode('nico100')).toBe(true);
        expect(isPlausiblePromoCode('A-B-C-D')).toBe(true);
        expect(isPlausiblePromoCode('tiny')).toBe(false);
        expect(isPlausiblePromoCode('-nico100')).toBe(false);
        expect(isPlausiblePromoCode('nico 100')).toBe(false);
        expect(isPlausiblePromoCode('this-code-is-far-too-long')).toBe(false);
    });

    it('stores domain-separated deterministic digests, never the raw code or email', () => {
        const codeDigest = digestPromoCode('nico100', PEPPER);
        const emailDigest = promoRedeemerDigest(' Ana@Example.COM ', PEPPER);

        expect(codeDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(emailDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(codeDigest).not.toBe(emailDigest);
        expect(codeDigest).toBe(digestPromoCode(' NICO100 ', PEPPER));
        expect(emailDigest).toBe(promoRedeemerDigest('ana@example.com', PEPPER));
        expect(`${codeDigest}${emailDigest}`).not.toMatch(/nico|ana|example/i);
    });

    it('is disabled unless the exact production switch is true', () => {
        expect(promoInvitationsEnabled()).toBe(false);
        expect(promoInvitationsEnabled('false')).toBe(false);
        expect(promoInvitationsEnabled('TRUE')).toBe(false);
        expect(promoInvitationsEnabled('true')).toBe(true);
    });
});
