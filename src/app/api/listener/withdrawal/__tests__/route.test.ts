import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const submitListenerWithdrawal = vi.hoisted(() => vi.fn());

vi.mock('@/lib/listener/consumer-withdrawal', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/listener/consumer-withdrawal')>();
    return { ...actual, submitListenerWithdrawal };
});

import {
    ListenerWithdrawalRateLimitError,
} from '@/lib/listener/consumer-withdrawal';
import { POST } from '../route';

const HOST = 'listen.harmonicbeacon.com';
const BODY = {
    email: 'listener@example.com',
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    locale: 'en',
    provider: 'PAYPAL',
    purchaseDate: '',
};

function request(overrides: {
    body?: unknown;
    host?: string;
    origin?: string;
    intent?: string | null;
    contentType?: string;
    length?: string;
} = {}) {
    const raw = JSON.stringify(overrides.body ?? BODY);
    const host = overrides.host ?? HOST;
    const headers: Record<string, string> = {
        host,
        origin: overrides.origin ?? `https://${host}`,
        'x-forwarded-proto': 'https',
        'content-type': overrides.contentType ?? 'application/json',
        'content-length': overrides.length ?? String(new TextEncoder().encode(raw).byteLength),
        'x-real-ip': '192.0.2.10',
    };
    if (overrides.intent !== null) headers['x-listener-withdrawal-intent'] = overrides.intent ?? '1';
    return new NextRequest(`https://${host}/api/listener/withdrawal`, { method: 'POST', headers, body: raw });
}

describe('public Listener withdrawal API', () => {
    beforeEach(() => {
        process.env.LISTENER_WITHDRAWAL_SECRET = 'w'.repeat(32);
        submitListenerWithdrawal.mockReset();
        submitListenerWithdrawal.mockResolvedValue({
            receiptCode: 'HBW-1234567890ABCDEF1234567890ABCD',
            receivedAt: new Date('2026-08-13T19:00:00.000Z'),
            replayed: false,
        });
    });

    it('accepts without a session and returns only an opaque receipt', async () => {
        const response = await POST(request());
        expect(response.status).toBe(201);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            receiptCode: 'HBW-1234567890ABCDEF1234567890ABCD',
            receivedAt: '2026-08-13T19:00:00.000Z',
        });
        expect(submitListenerWithdrawal).toHaveBeenCalledWith(expect.objectContaining({
            networkIdentity: '192.0.2.10',
            secret: 'w'.repeat(32),
        }));
    });

    it.each([
        { host: 'live.harmonicbeacon.com' },
        { origin: 'https://attacker.example' },
        { intent: null },
        { contentType: 'text/plain' },
    ])('rejects an untrusted CSRF/host boundary %#', async (overrides) => {
        expect((await POST(request(overrides))).status).toBe(403);
        expect(submitListenerWithdrawal).not.toHaveBeenCalled();
    });

    it('bounds payload size before parsing', async () => {
        expect((await POST(request({ length: '2049' }))).status).toBe(413);
        expect(submitListenerWithdrawal).not.toHaveBeenCalled();
    });

    it('fails closed without its dedicated secret', async () => {
        delete process.env.LISTENER_WITHDRAWAL_SECRET;
        expect((await POST(request())).status).toBe(503);
        expect(submitListenerWithdrawal).not.toHaveBeenCalled();
    });

    it('returns one generic rate response without exposing an account or provider fact', async () => {
        submitListenerWithdrawal.mockRejectedValue(new ListenerWithdrawalRateLimitError());
        const response = await POST(request());
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('3600');
        expect(JSON.stringify(await response.json())).not.toMatch(/paypal|account|email/i);
    });
});
