import { describe, expect, it } from 'vitest';

import { MAX_COMPOSITE_CELLS, parseCompositeLayout } from '../tapestry-layout';

function validLayout(overrides: Record<string, unknown> = {}) {
    return {
        revision: 7,
        columns: 2,
        rows: 1,
        tileSizePx: 100,
        frameTtlMs: 10_000,
        cells: [
            { id: 'tp-ana', column: 0, row: 0 },
            { id: 'tp-beto', column: 1, row: 0 },
        ],
        ...overrides,
    };
}

describe('parseCompositeLayout', () => {
    it('accepts a well-formed layout', () => {
        expect(parseCompositeLayout(validLayout())).toEqual({
            revision: 7,
            columns: 2,
            rows: 1,
            tileSizePx: 100,
            frameTtlMs: 10_000,
            cells: [
                { id: 'tp-ana', column: 0, row: 0 },
                { id: 'tp-beto', column: 1, row: 0 },
            ],
        });
    });

    it('rejects duplicate tile ids rather than picking one', () => {
        const body = validLayout({
            cells: [
                { id: 'tp-ana', column: 0, row: 0 },
                { id: 'tp-ana', column: 1, row: 0 },
            ],
        });
        expect(parseCompositeLayout(body)).toBeNull();
    });

    it('rejects more cells than the 150-participant cap', () => {
        const cells = Array.from({ length: MAX_COMPOSITE_CELLS + 1 }, (_, i) => ({
            id: `tp-${i}`,
            column: 0,
            row: 0,
        }));
        expect(parseCompositeLayout(validLayout({ columns: 1, rows: 1, cells }))).toBeNull();
    });

    it('accepts exactly 150 cells', () => {
        const cells = Array.from({ length: MAX_COMPOSITE_CELLS }, (_, i) => ({
            id: `tp-${i}`,
            column: i % 15,
            row: Math.floor(i / 15),
        }));
        const parsed = parseCompositeLayout(validLayout({ columns: 15, rows: 10, cells }));
        expect(parsed?.cells).toHaveLength(150);
    });

    it.each([
        ['an invalid tile id shape', { cells: [{ id: 'bad id!', column: 0, row: 0 }] }],
        ['a cell beyond the grid', { cells: [{ id: 'tp-a', column: 5, row: 0 }] }],
        ['a negative revision', { revision: -1 }],
        ['zero columns', { columns: 0 }],
        ['a missing cells array', { cells: undefined }],
        ['a non-integer column', { cells: [{ id: 'tp-a', column: 0.5, row: 0 }] }],
        ['null', null],
        ['a string', 'not-a-layout'],
    ])('fails safe on %s', (_label, override) => {
        const body = override === null || typeof override !== 'object' || Array.isArray(override)
            ? override
            : validLayout(override);
        expect(parseCompositeLayout(body)).toBeNull();
    });

    it('degrades freshness when the service predates frameTtlMs', () => {
        const parsed = parseCompositeLayout(validLayout({ frameTtlMs: undefined }));
        expect(parsed?.frameTtlMs).toBeNull();
    });
});
