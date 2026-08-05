/**
 * Shared validation for the internal tapestry service's layout endpoint
 * (TAP-02 review, hardening): every consumer — the staff manifest and the
 * public hands sidecar — parses the response through this single validator.
 *
 * Fail-safe by contract: anything unexpected returns null, and the caller
 * degrades to "no overlay" instead of trusting a malformed grid. Nothing
 * internal is logged or surfaced: the absence of a layout says enough.
 */

/** Opaque tile ids are URL-safe and length-bounded, as in the service config. */
const TILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Hard cap matching the service's maxParticipantsPerSession. */
export const MAX_COMPOSITE_CELLS = 150;

export type CompositeLayoutCell = {
    id: string;
    column: number;
    row: number;
};

export type CompositeLayout = {
    revision: number;
    columns: number;
    rows: number;
    tileSizePx: number;
    frameTtlMs: number | null;
    cells: CompositeLayoutCell[];
};

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Parse an untrusted layout response. Returns null when the shape, bounds
 * or uniqueness constraints are not met — including duplicate tile ids,
 * which would make cell lookup ambiguous and could misplace an overlay.
 */
export function parseCompositeLayout(body: unknown): CompositeLayout | null {
    const raw = body as Partial<CompositeLayout> | null;
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    if (
        !isNonNegativeInteger(raw.revision) ||
        !isNonNegativeInteger(raw.columns) || raw.columns < 1 ||
        !isNonNegativeInteger(raw.rows) || raw.rows < 1 ||
        !isNonNegativeInteger(raw.tileSizePx) || raw.tileSizePx < 1 ||
        !Array.isArray(raw.cells) ||
        raw.cells.length > MAX_COMPOSITE_CELLS
    ) {
        return null;
    }

    const seen = new Set<string>();
    const cells: CompositeLayoutCell[] = [];
    for (const cell of raw.cells) {
        if (
            !cell || typeof cell !== 'object' ||
            typeof cell.id !== 'string' ||
            !TILE_ID_PATTERN.test(cell.id) ||
            !isNonNegativeInteger(cell.column) || cell.column >= raw.columns ||
            !isNonNegativeInteger(cell.row) || cell.row >= raw.rows
        ) {
            return null;
        }
        if (seen.has(cell.id)) {
            // A duplicated tile id makes every name/cell mapping suspect.
            return null;
        }
        seen.add(cell.id);
        cells.push({ id: cell.id, column: cell.column, row: cell.row });
    }

    return {
        revision: raw.revision,
        columns: raw.columns,
        rows: raw.rows,
        tileSizePx: raw.tileSizePx,
        // Older internal services predate frameTtlMs; freshness copy degrades
        // to a generic note rather than a fabricated number.
        frameTtlMs: isNonNegativeInteger(raw.frameTtlMs) && raw.frameTtlMs > 0
            ? raw.frameTtlMs
            : null,
        cells,
    };
}
