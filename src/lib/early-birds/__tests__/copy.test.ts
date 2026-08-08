import { describe, expect, it } from 'vitest';

import { earlyBirdCopy, earlyBirdHomeCopy } from '@/lib/early-birds/copy';

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
});
