/**
 * The tag requirements a meditation must satisfy to be published
 * (BUSINESS_RULES.md §2.1).
 *
 * Kept separate from the approval route so the rule is testable on its own, and
 * so the two callers that could need it — Admin approval and any future
 * Provider-side pre-flight check — cannot drift apart.
 */

export type TagCategory = 'MOOD' | 'TECHNIQUE' | 'DURATION' | 'LANGUAGE';

/** One of these is enough to satisfy the descriptive-tag requirement. */
const DESCRIPTIVE_CATEGORIES: TagCategory[] = ['MOOD', 'TECHNIQUE', 'DURATION'];

/**
 * Returns a message naming every unmet publication requirement, or null when the
 * tags satisfy §2.1.
 *
 * The message names the specific requirement rather than reporting a generic
 * failure: an Admin who cannot publish needs to know whether to add a language
 * tag or a mood tag. When both are missing both are listed, so a second attempt
 * does not fail for the other reason.
 */
export function findMissingPublicationTags(categories: readonly string[]): string | null {
    const missing: string[] = [];

    if (!categories.includes('LANGUAGE')) {
        missing.push('a LANGUAGE tag');
    }

    if (!categories.some((category) => DESCRIPTIVE_CATEGORIES.includes(category as TagCategory))) {
        missing.push('at least one MOOD, TECHNIQUE or DURATION tag');
    }

    if (missing.length === 0) return null;

    return `Cannot publish: meditation is missing ${missing.join(' and ')}. ` +
        'Publication requires a LANGUAGE tag plus at least one of MOOD, TECHNIQUE or DURATION.';
}
