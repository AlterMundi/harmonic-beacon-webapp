import { createHmac } from 'node:crypto';

import { constantTimeDigestEqual } from './session-auth';

export type TicketCodeStorage = {
    codeDigest: string;
    codeLastFour: string;
};

export function normalizeTicketCode(code: string): string {
    const normalized = code.trim().toUpperCase();
    const compact = normalized.replace(/[\s-]/g, '');
    if (/^HB1[A-HJ-NP-Z2-9]{32}$/.test(compact)) {
        const payload = compact.slice(3);
        return `HB1-${payload.match(/.{4}/g)!.join('-')}`;
    }
    return normalized;
}

export function isCanonicalCommerceCredential(code: string): boolean {
    return /^HB1(?:-[A-HJ-NP-Z2-9]{4}){8}$/.test(code);
}

export function ticketCodePepper(
    rawValue = process.env.TICKET_CODE_PEPPER,
): string {
    if (!rawValue || rawValue.length < 32) {
        throw new Error('TICKET_CODE_PEPPER must contain at least 32 characters');
    }
    return rawValue;
}

export function digestTicketCode(code: string, pepper = ticketCodePepper()): string {
    const normalizedCode = normalizeTicketCode(code);
    if (normalizedCode.length < 16) {
        throw new Error('Ticket codes must contain at least 16 characters');
    }

    return createHmac('sha256', pepper).update(normalizedCode, 'utf8').digest('hex');
}

export function ticketCodeStorage(
    code: string,
    pepper = ticketCodePepper(),
): TicketCodeStorage {
    const normalizedCode = normalizeTicketCode(code);
    return {
        codeDigest: digestTicketCode(normalizedCode, pepper),
        codeLastFour: normalizedCode.slice(-4),
    };
}

export function ticketCodeMatchesDigest(
    code: string,
    storedDigest: string,
    pepper = ticketCodePepper(),
): boolean {
    return constantTimeDigestEqual(digestTicketCode(code, pepper), storedDigest);
}
