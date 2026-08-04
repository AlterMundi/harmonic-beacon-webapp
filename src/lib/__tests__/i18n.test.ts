import { describe, expect, it } from 'vitest';

import {
    STAFF_ROLE_KEYS,
    localeForEventLanguage,
    messages,
    parseUiLocale,
    resolveUiLocale,
    staffRolePresentation,
} from '@/lib/i18n';

describe('UI locale policy', () => {
    it('accepts only supported persisted locale values', () => {
        expect(parseUiLocale('es')).toBe('es');
        expect(parseUiLocale('en')).toBe('en');
        expect(parseUiLocale('EN')).toBeNull();
        expect(parseUiLocale(undefined)).toBeNull();
    });

    it('uses event language only when there is no persisted preference', () => {
        expect(resolveUiLocale('en', 'SPANISH')).toBe('en');
        expect(resolveUiLocale(null, 'ENGLISH')).toBe('en');
        expect(resolveUiLocale(null, 'SPANISH')).toBe('es');
        expect(resolveUiLocale(null)).toBe('es');
    });

    it('maps every event language explicitly', () => {
        expect(localeForEventLanguage('ENGLISH')).toBe('en');
        expect(localeForEventLanguage('SPANISH')).toBe('es');
    });

    it('keeps ES and EN dictionary shapes identical', () => {
        expect(Object.keys(messages.es)).toEqual(Object.keys(messages.en));
        for (const section of Object.keys(messages.es) as Array<keyof typeof messages.es>) {
            expect(Object.keys(messages.es[section])).toEqual(Object.keys(messages.en[section]));
        }
    });

    it.each(STAFF_ROLE_KEYS)('provides bilingual capability guidance for %s', (role) => {
        for (const locale of ['es', 'en'] as const) {
            const presentation = staffRolePresentation(messages[locale], role);
            expect(presentation.label.length).toBeGreaterThan(3);
            expect(presentation.description.length).toBeGreaterThan(30);
            expect(presentation.description).not.toContain(role);
        }
    });
});
