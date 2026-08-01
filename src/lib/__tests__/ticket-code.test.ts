import { describe, expect, it } from 'vitest';

import {
    digestTicketCode,
    isCanonicalCommerceCredential,
    normalizeTicketCode,
    ticketCodeMatchesDigest,
    ticketCodePepper,
    ticketCodeStorage,
} from '../ticket-code';

const PEPPER = 'test-only-pepper-with-at-least-32-characters';
const CODE = 'HB26-A7NQ-92KM-X4PZ';

describe('ticket code storage', () => {
    it('stores only an HMAC digest and the non-secret last four characters', () => {
        const database = ticketCodeStorage(CODE, PEPPER);

        expect(database).toEqual({
            codeDigest: digestTicketCode(CODE, PEPPER),
            codeLastFour: 'X4PZ',
        });
        expect(JSON.stringify(database)).not.toContain(CODE);
        expect(database.codeDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(database.codeDigest).not.toBe(digestTicketCode(CODE, `${PEPPER}-different`));
    });

    it('normalizes codes and compares their digests in constant time', () => {
        const digest = digestTicketCode(CODE, PEPPER);

        expect(normalizeTicketCode(`  ${CODE.toLowerCase()}  `)).toBe(CODE);
        expect(ticketCodeMatchesDigest(`  ${CODE.toLowerCase()}  `, digest, PEPPER)).toBe(true);
        expect(ticketCodeMatchesDigest('HB26-A7NQ-92KM-NOPE', digest, PEPPER)).toBe(false);
    });

    it('fails closed without a sufficiently strong pepper', () => {
        expect(() => ticketCodePepper(undefined)).toThrow(/TICKET_CODE_PEPPER/);
        expect(() => ticketCodePepper('short')).toThrow(/at least 32/);
    });

    it('canonicalizes long HB1 credentials without changing legacy codes', () => {
        const canonical = 'HB1-7MMP-T82D-F5UD-DF82-M7QP-XVK7-EXQQ-Q4CS';

        expect(normalizeTicketCode(canonical.toLowerCase())).toBe(canonical);
        expect(normalizeTicketCode(canonical.replaceAll('-', ''))).toBe(canonical);
        expect(normalizeTicketCode(`  hb1 7mmp t82d f5ud df82 m7qp xvk7 exqq q4cs  `)).toBe(canonical);
        expect(normalizeTicketCode(CODE.toLowerCase())).toBe(CODE);
        expect(isCanonicalCommerceCredential(canonical)).toBe(true);
        expect(isCanonicalCommerceCredential(canonical.replace('Q4CS', 'Q4O5'))).toBe(false);
    });

    it('matches a stored long credential after human-friendly input normalization', () => {
        const canonical = 'HB1-7MMP-T82D-F5UD-DF82-M7QP-XVK7-EXQQ-Q4CS';
        const digest = digestTicketCode(canonical, PEPPER);

        expect(ticketCodeMatchesDigest(canonical.toLowerCase().replaceAll('-', ' '), digest, PEPPER)).toBe(true);
        expect(ticketCodeMatchesDigest(canonical.replace(/.$/, 'A'), digest, PEPPER)).toBe(false);
    });
});
