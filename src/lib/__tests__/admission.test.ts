import { describe, it, expect } from 'vitest';

import {
    TICKET_CODE_PATTERN,
    batchExceedsCap,
    buildTicketCsv,
    classifyLookup,
    generateTicketCode,
    generateTicketCodes,
    normalizeEmail,
    parseTicketCsv,
    ticketExpiresAt,
} from '../admission';

describe('generateTicketCode', () => {
    it('produces the grouped 16-character format', () => {
        expect(generateTicketCode()).toMatch(TICKET_CODE_PATTERN);
    });

    it('avoids ambiguous characters (0, O, 1, I, L)', () => {
        for (let index = 0; index < 200; index += 1) {
            expect(generateTicketCode()).not.toMatch(/[01OIL]/);
        }
    });
});

describe('generateTicketCodes', () => {
    it('yields 150 unique high-entropy values for a full event batch', () => {
        const codes = generateTicketCodes(150);
        expect(new Set(codes).size).toBe(150);
        for (const code of codes) {
            expect(code).toMatch(TICKET_CODE_PATTERN);
        }
    });

    it('rejects a non-positive count', () => {
        expect(() => generateTicketCodes(0)).toThrow();
    });
});

describe('buildTicketCsv', () => {
    it('emits code, tier, event title, and URL prefix columns', () => {
        const csv = buildTicketCsv([
            { code: 'AAAA-BBBB-CCCC-DDDD', tier: 'GLOBAL_NORTH', eventTitle: 'Saturday Session', urlPrefix: 'https://live.harmonicbeacon.com/' },
        ]);
        const lines = csv.split('\n');
        expect(lines[0]).toBe('code,tier,event,url');
        expect(lines[1]).toBe('AAAA-BBBB-CCCC-DDDD,GLOBAL_NORTH,Saturday Session,https://live.harmonicbeacon.com/');
    });

    it('escapes commas and quotes in event titles', () => {
        const csv = buildTicketCsv([
            { code: 'AAAA-BBBB-CCCC-DDDD', tier: 'COMP', eventTitle: 'Session, "EN"', urlPrefix: 'https://x/' },
        ]);
        expect(csv.split('\n')[1]).toBe('AAAA-BBBB-CCCC-DDDD,COMP,"Session, ""EN""",https://x/');
    });
});

describe('parseTicketCsv', () => {
    it('reads the first column, skipping a header row', () => {
        const csv = 'code,tier\nAAAA-BBBB-CCCC-DDDD,GLOBAL_NORTH\nEEEE-FFFF-GGGG-HHHH,GLOBAL_NORTH\n';
        expect(parseTicketCsv(csv)).toEqual(['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH']);
    });

    it('works without a header and normalizes case', () => {
        expect(parseTicketCsv('aaaa-bbbb-cccc-dddd')).toEqual(['AAAA-BBBB-CCCC-DDDD']);
    });

    it('rejects a row that is not a valid code', () => {
        expect(() => parseTicketCsv('not-a-code')).toThrow(/Row 1/);
    });

    it('rejects an empty file', () => {
        expect(() => parseTicketCsv('code\n\n')).toThrow(/no ticket codes/);
    });
});

describe('batchExceedsCap', () => {
    it('allows a batch that fills the cap exactly', () => {
        expect(batchExceedsCap(150, 100, 50)).toBe(false);
    });

    it('rejects the batch that would take paid plus comp above the cap', () => {
        expect(batchExceedsCap(150, 100, 51)).toBe(true);
        expect(batchExceedsCap(150, 150, 1)).toBe(true);
    });
});

describe('ticketExpiresAt', () => {
    it('extends past the event by the support window', () => {
        const start = new Date('2026-08-01T18:00:00Z');
        const expiry = ticketExpiresAt(start, new Date('2026-07-29T00:00:00Z'));
        expect(expiry.getTime()).toBe(start.getTime() + 24 * 60 * 60 * 1000);
    });

    it('never expires in the past for a mid-event override', () => {
        const start = new Date('2026-08-01T18:00:00Z');
        const now = new Date('2026-08-05T00:00:00Z');
        expect(ticketExpiresAt(start, now).getTime()).toBeGreaterThan(now.getTime());
    });
});

describe('normalizeEmail', () => {
    it('trims and lowercases, matching the binding contract', () => {
        expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
    });
});

describe('classifyLookup', () => {
    it('recognizes an entitlement UUID', () => {
        expect(classifyLookup('3F6B1A2E-1234-4ABC-9DEF-0123456789AB')).toEqual({
            kind: 'id',
            id: '3f6b1a2e-1234-4abc-9def-0123456789ab',
        });
    });

    it('recognizes and normalizes an email', () => {
        expect(classifyLookup(' Buyer@Example.com ')).toEqual({ kind: 'email', email: 'buyer@example.com' });
    });

    it('recognizes a code last-four, uppercased', () => {
        expect(classifyLookup('ab3f')).toEqual({ kind: 'last4', last4: 'AB3F' });
    });

    it('returns null for anything else', () => {
        expect(classifyLookup('hello')).toBeNull();
        expect(classifyLookup('')).toBeNull();
        expect(classifyLookup('a@b')).toBeNull();
    });
});
