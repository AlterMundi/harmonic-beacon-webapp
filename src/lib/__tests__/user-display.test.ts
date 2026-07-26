import { describe, it, expect } from 'vitest';
import {
    displayName,
    isDeleted,
    DELETED_ACCOUNT_LABEL,
    ANONYMOUS_LABEL,
} from '../user-display';

describe('displayName', () => {
    it('returns the name when there is one', () => {
        expect(displayName({ name: 'Ana' })).toBe('Ana');
    });

    it('distinguishes a deleted account from one that never set a name', () => {
        // The distinction is the point. Before this, deletion nulled `name` and
        // every surface rendered a blank, collapsing "chose no name" into
        // "asked to be forgotten" — and reading as a bug rather than either.
        expect(displayName({ name: null })).toBe(ANONYMOUS_LABEL);
        expect(displayName({ name: null, deletedAt: new Date() })).toBe(DELETED_ACCOUNT_LABEL);
        expect(ANONYMOUS_LABEL).not.toBe(DELETED_ACCOUNT_LABEL);
    });

    it('reports deleted even if a name somehow survived', () => {
        // Deletion overwrites `name`, so this should not arise — but if it ever
        // does, the deletion is the fact that matters and the name must not leak.
        expect(displayName({ name: 'Ana', deletedAt: new Date() })).toBe(DELETED_ACCOUNT_LABEL);
    });

    it('accepts a serialized date, since these cross an API boundary', () => {
        expect(displayName({ name: null, deletedAt: '2026-07-26T00:00:00.000Z' }))
            .toBe(DELETED_ACCOUNT_LABEL);
    });

    it('treats a missing relation as deleted rather than anonymous', () => {
        // ListeningSession.meditation and .scheduledSession are onDelete: SetNull,
        // so a null relation means the thing it pointed at is gone.
        expect(displayName(null)).toBe(DELETED_ACCOUNT_LABEL);
        expect(displayName(undefined)).toBe(DELETED_ACCOUNT_LABEL);
    });

    it('treats a whitespace-only name as unset', () => {
        expect(displayName({ name: '   ' })).toBe(ANONYMOUS_LABEL);
    });
});

describe('isDeleted', () => {
    it('is false for a live account and true for a deleted one', () => {
        expect(isDeleted({ name: 'Ana' })).toBe(false);
        expect(isDeleted({ name: null, deletedAt: null })).toBe(false);
        expect(isDeleted({ name: null, deletedAt: new Date() })).toBe(true);
    });
});
