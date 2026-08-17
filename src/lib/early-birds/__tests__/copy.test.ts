import { describe, expect, it } from 'vitest';

import { earlyBirdCopy, earlyBirdHomeCopy, earlyBirdLegalCopy } from '@/lib/early-birds/copy';

describe('EarlyBirds interface copy', () => {
    it.each([
        ['landing · Spanish', earlyBirdCopy.es],
        ['landing · English', earlyBirdCopy.en],
        ['listener · Spanish', earlyBirdHomeCopy.es],
        ['listener · English', earlyBirdHomeCopy.en],
    ])('keeps the Beacon source-neutral in %s', (_label, copy) => {
        const visibleCopy = Object.values(copy).join(' ');

        expect(visibleCopy).not.toMatch(
            /record(?:ed|ing)?|grabaci[oó]n|grabad[oa]|live instrument|instrumento en vivo/i,
        );
    });

    it('identifies the initial merchant and billing contact in both public terms locales', () => {
        const spanish = earlyBirdLegalCopy.es.sections.flatMap((section) => section.paragraphs).join(' ');
        const english = earlyBirdLegalCopy.en.sections.flatMap((section) => section.paragraphs).join(' ');

        for (const visibleCopy of [spanish, english]) {
            expect(visibleCopy).toContain('Nicolás Echaniz');
            expect(visibleCopy).toContain('nicoechaniz@harmonicbeacon.com');
            expect(visibleCopy).toMatch(/merchant of record/i);
            expect(visibleCopy).toMatch(/PayPal/);
            expect(visibleCopy).toMatch(/Mercado Pago/);
        }
    });

    it('keeps cancellation prospective and refunds manual-only in both locales', () => {
        const spanishTerms = earlyBirdLegalCopy.es.sections.flatMap((section) => section.paragraphs).join(' ');
        const englishTerms = earlyBirdLegalCopy.en.sections.flatMap((section) => section.paragraphs).join(' ');

        expect(earlyBirdCopy.es.membershipCancelConfirmDetail).toMatch(/próximos cobros.*No se reembolsa/i);
        expect(earlyBirdCopy.en.membershipCancelConfirmDetail).toMatch(/Future charges.*not refunded/i);
        expect(spanishTerms).toMatch(/reembolsos.*no.*automáticos.*manualmente/i);
        expect(englishTerms).toMatch(/Refunds.*never automatic.*manually/i);
    });
});
