import { analyticsCsv, analyticsCsvCell } from '@/lib/analytics-csv';
import { describe, expect, it } from 'vitest';

describe('analytics CSV export', () => {
    it('escapes quotes and neutralizes spreadsheet formulas', () => {
        expect(analyticsCsvCell('normal "value"')).toBe('"normal ""value"""');
        expect(analyticsCsvCell('=HYPERLINK("https://example.invalid")')).toBe('"\'=HYPERLINK(""https://example.invalid"")"');
        expect(analyticsCsvCell('+1')).toBe('"\'+1"');
        expect(analyticsCsvCell('-1')).toBe('"\'-1"');
        expect(analyticsCsvCell('@cmd')).toBe('"\'@cmd"');
    });

    it('exports only object rows with a stable union of columns', () => {
        expect(analyticsCsv([{ source: 'newsletter', visits: 2 }, { source: 'direct', sessions: 1 }, null])).toBe(
            '"source","visits","sessions"\n"newsletter","2",""\n"direct","","1"',
        );
    });
});
