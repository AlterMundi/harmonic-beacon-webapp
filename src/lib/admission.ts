/**
 * Weekend admission support: ticket code generation, the one-time operator CSV
 * export, attendee-cap enforcement, and lookup classification.
 *
 * The security contract lives in `src/lib/ticket-code.ts`: the database stores
 * an HMAC digest and the last four characters of each code, never the
 * plaintext. This module is the only place codes are created. Plaintext codes
 * exist in exactly two places — the one-time CSV returned to the operator (or
 * written by `scripts/weekend-tickets.ts`) and the buyer's inbox — and must
 * never appear in application logs.
 */

import { randomBytes } from 'node:crypto';

/**
 * Unambiguous uppercase alphabet: no 0/O, 1/I/L. Operators read codes over the
 * phone during admission support, and a misread character is a failed login.
 */
export const TICKET_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TICKET_CODE_BODY_LENGTH = 16;
export const TICKET_CODE_PATTERN =
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/**
 * Tickets stay redeemable through the event plus a 24h support window so a
 * buyer who hits trouble at doors can still be admitted by support afterwards.
 */
export const TICKET_SUPPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const TICKET_CSV_HEADER = 'code,tier,event,url';

export type TicketCsvRow = {
    code: string;
    tier: string;
    eventTitle: string;
    urlPrefix: string;
};

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/**
 * One high-entropy code: 16 alphabet characters ≈ 80 bits, grouped for
 * humans. The grouped form is 19 chars, comfortably above the 16-char minimum
 * `digestTicketCode` enforces after normalization.
 */
export function generateTicketCode(random: (size: number) => Buffer = randomBytes): string {
    const bytes = random(TICKET_CODE_BODY_LENGTH);
    const body = Array.from(
        bytes,
        (byte) => TICKET_CODE_ALPHABET[byte % TICKET_CODE_ALPHABET.length],
    ).join('');
    return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

/** `count` unique codes. Throws if the RNG collides past a generous retry budget. */
export function generateTicketCodes(count: number): string[] {
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('Ticket batch count must be a positive integer');
    }

    const codes = new Set<string>();
    while (codes.size < count) {
        codes.add(generateTicketCode());
    }
    return [...codes];
}

function csvField(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The one-time operator export for the ticket platform. Column set is the
 * WS1-03 contract (code, tier, event title, URL prefix); WS6-01 confirms
 * Ticket Tailor's exact import format before these columns are locked.
 */
export function buildTicketCsv(rows: TicketCsvRow[]): string {
    const lines = rows.map((row) =>
        [row.code, row.tier, row.eventTitle, row.urlPrefix].map(csvField).join(','),
    );
    return [TICKET_CSV_HEADER, ...lines].join('\n') + '\n';
}

/**
 * Extract candidate codes from operator-supplied CSV text: first column of
 * each row, header row skipped. Blank lines are ignored; anything that does
 * not look like a grouped code is rejected so a malformed import fails loudly
 * instead of minting unusable entitlements.
 */
export function parseTicketCsv(csvText: string): string[] {
    const codes: string[] = [];
    const lines = csvText.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
        const firstField = line.split(',')[0]?.trim() ?? '';
        if (firstField === '') {
            continue;
        }
        if (index === 0 && firstField.toLowerCase() === 'code') {
            continue;
        }

        const candidate = firstField.toUpperCase();
        if (!TICKET_CODE_PATTERN.test(candidate)) {
            throw new Error(`Row ${index + 1} does not contain a valid ticket code`);
        }
        codes.push(candidate);
    }

    if (codes.length === 0) {
        throw new Error('CSV contains no ticket codes');
    }
    return codes;
}

/**
 * Every entitlement that has not been revoked holds one of the event's 150
 * seats — paid, comp, and support override alike. `activeCount` is the number
 * of non-revoked entitlements the caller counted for the session.
 */
export function batchExceedsCap(attendeeCap: number, activeCount: number, additional: number): boolean {
    return activeCount + additional > attendeeCap;
}

/** Ticket expiry: the event start plus the support window. */
export function ticketExpiresAt(scheduledAt: Date, now = new Date()): Date {
    const expiry = new Date(scheduledAt.getTime() + TICKET_SUPPORT_WINDOW_MS);
    // A ticket generated after its event (a mid-event support override) still
    // needs to outlive the moment it is issued.
    return expiry > now ? expiry : new Date(now.getTime() + TICKET_SUPPORT_WINDOW_MS);
}

export type AdmissionLookup =
    | { kind: 'id'; id: string }
    | { kind: 'email'; email: string }
    | { kind: 'last4'; last4: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LAST4_PATTERN = /^[A-Za-z0-9]{4}$/;

/**
 * Classify one free-text operator query: an entitlement UUID, an email, or a
 * code last-four. Returns null for anything else so the route can answer 400
 * rather than guessing.
 */
export function classifyLookup(query: string): AdmissionLookup | null {
    const trimmed = query.trim();
    if (UUID_PATTERN.test(trimmed)) {
        return { kind: 'id', id: trimmed.toLowerCase() };
    }
    if (trimmed.includes('@')) {
        const email = normalizeEmail(trimmed);
        return email.length > 3 ? { kind: 'email', email } : null;
    }
    if (LAST4_PATTERN.test(trimmed)) {
        return { kind: 'last4', last4: trimmed.toUpperCase() };
    }
    return null;
}
