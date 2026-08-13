import { describe, expect, it } from 'vitest';

import {
    ListenerWithdrawalInputError,
    listenerWithdrawalReceiptCode,
    listenerWithdrawalReceiptDigest,
    listenerWithdrawalRequestHash,
    parseListenerWithdrawalInput,
} from '../consumer-withdrawal';

const BASE = {
    email: ' Listener@Example.com ',
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    locale: 'es',
    provider: 'PAYPAL',
    purchaseDate: '2026-08-12',
};

describe('Listener consumer-withdrawal contract', () => {
    it('normalizes only bounded fields needed to locate a purchase', () => {
        expect(parseListenerWithdrawalInput(BASE, new Date('2026-08-13T12:00:00Z'))).toEqual({
            email: 'listener@example.com',
            idempotencyKey: BASE.idempotencyKey,
            locale: 'es',
            provider: 'PAYPAL',
            purchaseDate: new Date('2026-08-12T00:00:00.000Z'),
        });
    });

    it.each([
        { ...BASE, accepted: false },
        { ...BASE, provider: 'paypal' },
        { ...BASE, email: 'not-an-email' },
        { ...BASE, purchaseDate: '2026-08-14' },
        { ...BASE, idempotencyKey: 'predictable' },
        { ...BASE, detail: 'unrequested free text' },
        { ...BASE, providerId: 'raw-provider-id' },
    ])('rejects malformed, excessive or extra input %#', (input) => {
        expect(() => parseListenerWithdrawalInput(input, new Date('2026-08-13T12:00:00Z')))
            .toThrow(ListenerWithdrawalInputError);
    });

    it('derives a replayable opaque receipt without embedding request facts', () => {
        const parsed = parseListenerWithdrawalInput(BASE, new Date('2026-08-13T12:00:00Z'));
        const receipt = listenerWithdrawalReceiptCode(parsed.idempotencyKey);
        expect(receipt).toMatch(/^HBW-[0-9A-F]{30}$/);
        expect(receipt).not.toContain('PAYPAL');
        expect(receipt).not.toContain('LISTENER');
        expect(listenerWithdrawalReceiptCode(parsed.idempotencyKey)).toBe(receipt);
        expect(listenerWithdrawalReceiptDigest(receipt)).toMatch(/^[0-9a-f]{64}$/);
        expect(listenerWithdrawalRequestHash(parsed)).toMatch(/^[0-9a-f]{64}$/);
    });
});
