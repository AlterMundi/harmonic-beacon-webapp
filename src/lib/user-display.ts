/**
 * How a user is named on a surface someone else can see.
 *
 * Account deletion anonymises in place rather than dropping the row
 * (`BUSINESS_RULES.md` §9.1): published content and other listeners' history
 * reference it, so the row survives with every identifying column overwritten.
 * `name` becomes null, and the surfaces that render it were left showing a blank
 * where a person used to be.
 *
 * Blank is the wrong answer twice over. It reads as a defect rather than a
 * choice, and it collapses two different situations — someone who never set a
 * name, and someone who asked to be forgotten. The second is a request the
 * product agreed to honour and should be visibly honoured, not silently dropped.
 */

/** Enough of a user to name them. `deletedAt` must be selected for this to work. */
export interface DisplayableUser {
    name?: string | null;
    deletedAt?: Date | string | null;
}

/** Shown in place of a deleted account's name. Deliberately not a person's name. */
export const DELETED_ACCOUNT_LABEL = 'Deleted account';

/** Shown for an account that exists but never set a name. */
export const ANONYMOUS_LABEL = 'Anonymous';

export function isDeleted(user: DisplayableUser | null | undefined): boolean {
    return Boolean(user?.deletedAt);
}

/**
 * The name to render for a user on someone else's screen.
 *
 * A missing user — the relation was `SetNull`, so the row is gone entirely —
 * reads as deleted rather than anonymous, because that is what it means: the
 * thing it pointed at no longer exists.
 */
export function displayName(user: DisplayableUser | null | undefined): string {
    if (!user) return DELETED_ACCOUNT_LABEL;
    if (isDeleted(user)) return DELETED_ACCOUNT_LABEL;
    return user.name?.trim() || ANONYMOUS_LABEL;
}
