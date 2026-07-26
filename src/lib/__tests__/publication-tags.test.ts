import { describe, it, expect } from 'vitest';
import { findMissingPublicationTags } from '../publication-tags';

describe('findMissingPublicationTags', () => {
    it('passes a meditation with a LANGUAGE tag and a MOOD tag', () => {
        expect(findMissingPublicationTags(['LANGUAGE', 'MOOD'])).toBeNull();
    });

    it('accepts TECHNIQUE as the descriptive tag', () => {
        expect(findMissingPublicationTags(['LANGUAGE', 'TECHNIQUE'])).toBeNull();
    });

    it('accepts DURATION as the descriptive tag', () => {
        expect(findMissingPublicationTags(['DURATION', 'LANGUAGE'])).toBeNull();
    });

    it('names the language requirement when only a mood tag is present', () => {
        const error = findMissingPublicationTags(['MOOD']);
        expect(error).toContain('LANGUAGE');
        expect(error).not.toContain('missing at least one MOOD');
    });

    it('names the descriptive requirement when only a language tag is present', () => {
        const error = findMissingPublicationTags(['LANGUAGE']);
        expect(error).toContain('MOOD, TECHNIQUE or DURATION');
        expect(error).not.toContain('missing a LANGUAGE tag');
    });

    it('names both requirements when the meditation has no tags', () => {
        const error = findMissingPublicationTags([]);
        expect(error).toContain('a LANGUAGE tag');
        expect(error).toContain('at least one MOOD, TECHNIQUE or DURATION tag');
    });

    it('ignores unrecognised categories', () => {
        expect(findMissingPublicationTags(['SOMETHING_ELSE'])).not.toBeNull();
        expect(findMissingPublicationTags(['LANGUAGE', 'SOMETHING_ELSE'])).toContain(
            'MOOD, TECHNIQUE or DURATION',
        );
    });

    it('tolerates duplicate categories', () => {
        expect(findMissingPublicationTags(['LANGUAGE', 'LANGUAGE', 'MOOD', 'MOOD'])).toBeNull();
    });
});
