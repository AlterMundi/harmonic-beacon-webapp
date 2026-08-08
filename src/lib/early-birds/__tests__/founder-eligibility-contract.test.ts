import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    HttpEarlyBirdMembershipGateway,
} from '../membership-gateway';
import {
    EarlyBirdMembershipContractError,
    parseCanonicalAuthorityMembershipV2,
} from '../membership-contract';

const CONTRACT = resolve(process.cwd(), 'contracts/early-bird-authority/v2');
const fixture = JSON.parse(readFileSync(`${CONTRACT}/membership.fixture.json`, 'utf8')) as Record<string, unknown>;
const active: Record<string, unknown> = {
    ...fixture,
    account_id: 'listener-1',
    state: 'ACTIVE',
    access_allowed: true,
    effective_at: '2026-08-08T12:00:00Z',
    paid_through: '2027-08-08T12:00:00Z',
    reason_code: 'PAYMENT_SUCCEEDED',
};

function cancellableResponse(status: number, headers: Record<string, string> = {}) {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
            controller.enqueue(new Uint8Array([0x7b]));
        },
        cancel() {
            cancelled = true;
        },
    }, { highWaterMark: 0 }), { status, headers });
    return { response, wasCancelled: () => cancelled };
}

describe('canonical Founder membership read v2', () => {
    it('parses the byte-vendored positive fixture and a Free null eligibility', () => {
        expect(parseCanonicalAuthorityMembershipV2(fixture).founder_price_eligibility)
            .toEqual({
                ...(fixture.founder_price_eligibility as object),
                granted_at: '2026-08-06T12:00:00.000Z',
            });
        expect(parseCanonicalAuthorityMembershipV2({
            ...active,
            source: 'FREE',
            provider: null,
            current_price: null,
            founder_price_eligibility: null,
        }).founder_price_eligibility).toBeNull();
    });

    it.each([
        ['extra top-level field', { ...active, email: 'private@example.invalid' }],
        ['missing eligibility', Object.fromEntries(Object.entries(active).filter(([key]) => key !== 'founder_price_eligibility'))],
        ['wrong currency', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                canonical_price: { currency: 'ARS', amount_minor: 200 },
            },
        }],
        ['wrong amount', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                canonical_price: { currency: 'USD', amount_minor: 201 },
            },
        }],
        ['wrong period', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                billing_period: 'YEARLY',
            },
        }],
        ['impossible calendar date', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                granted_at: '2026-02-30T12:00:00Z',
            },
        }],
        ['invalid hour', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                granted_at: '2026-08-06T24:00:00Z',
            },
        }],
        ['unsafe revision', {
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: Number.MAX_SAFE_INTEGER + 1 },
            },
        }],
        ['paid access without eligibility', { ...active, founder_price_eligibility: null }],
    ])('rejects %s', (_label, payload) => {
        expect(() => parseCanonicalAuthorityMembershipV2(payload))
            .toThrow(EarlyBirdMembershipContractError);
    });

    it('accepts RFC 3339 offsets and canonicalizes equivalent instants to UTC milliseconds', () => {
        const withOffset = parseCanonicalAuthorityMembershipV2({
            ...active,
            effective_at: '2026-08-08T09:00:00-03:00',
            paid_through: '2027-08-08T09:00:00.000000000-03:00',
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                granted_at: '2026-08-06T09:00:00-03:00',
            },
        });
        const withFraction = parseCanonicalAuthorityMembershipV2({
            ...active,
            founder_price_eligibility: {
                ...(active.founder_price_eligibility as object),
                granted_at: '2026-08-06T12:00:00.000000000Z',
            },
        });
        expect(withOffset.founder_price_eligibility?.granted_at)
            .toBe('2026-08-06T12:00:00.000Z');
        expect(withOffset.effective_at).toBe('2026-08-08T12:00:00.000Z');
        expect(withOffset.paid_through).toBe('2027-08-08T12:00:00.000Z');
        expect(withFraction.founder_price_eligibility?.granted_at)
            .toBe('2026-08-06T12:00:00.000Z');
    });

    it.each([
        ['effective_at', { effective_at: '2026-02-30T12:00:00Z' }],
        ['paid_through', { paid_through: '2027-02-30T12:00:00Z' }],
        ['grace_until', { grace_until: '2026-08-08T12:00:00+24:00' }],
    ])('rejects invalid v2 %s while leaving the legacy v1 parser unchanged', (_label, override) => {
        expect(() => parseCanonicalAuthorityMembershipV2({ ...active, ...override }))
            .toThrow(EarlyBirdMembershipContractError);
    });

    it('uses the exact private GET and rejects mismatches or oversized bodies', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(active), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'http://pmp-myth-api:8765',
            keyId: '2026-08-current',
            token: 's'.repeat(43),
        }, request);

        await expect(gateway.readMembership('listener-1')).resolves.toMatchObject({
            ok: true,
            membership: { account_id: 'listener-1' },
        });
        expect(request).toHaveBeenCalledWith(
            'http://pmp-myth-api:8765/api/internal/v2/early-bird-memberships/listener-1',
            expect.objectContaining({
                method: 'GET',
                redirect: 'error',
                cache: 'no-store',
                headers: expect.objectContaining({
                    authorization: `Bearer ${'s'.repeat(43)}`,
                    'x-hb-service-key-id': '2026-08-current',
                }),
            }),
        );

        request.mockResolvedValueOnce(new Response(JSON.stringify({ ...active, account_id: 'other' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');

        const oversized = cancellableResponse(200, {
            'content-type': 'application/json',
            'content-length': String(65 * 1024),
        });
        request.mockResolvedValueOnce(oversized.response);
        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');
        expect(oversized.wasCancelled()).toBe(true);
    });

    it('distinguishes canonical not-found and fails closed on other statuses', async () => {
        const notFound = cancellableResponse(404);
        const request = vi.fn().mockResolvedValue(notFound.response);
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'https://authority.example.test',
            keyId: 'current',
            token: 's'.repeat(43),
        }, request);
        await expect(gateway.readMembership('listener-1')).resolves.toEqual({
            ok: false,
            reason: 'not-found',
        });
        expect(notFound.wasCancelled()).toBe(true);

        const unauthorized = cancellableResponse(401);
        request.mockResolvedValueOnce(unauthorized.response);
        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');
        expect(unauthorized.wasCancelled()).toBe(true);

        const wrongContentType = cancellableResponse(200, { 'content-type': 'text/html' });
        request.mockResolvedValueOnce(wrongContentType.response);
        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');
        expect(wrongContentType.wasCancelled()).toBe(true);
    });

    it('cancels an undeclared chunked body as soon as it exceeds 64 KiB', async () => {
        let pulls = 0;
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;
                if (pulls <= 4) {
                    controller.enqueue(new Uint8Array(24 * 1024).fill(0x20));
                } else {
                    controller.close();
                }
            },
            cancel() {
                cancelled = true;
            },
        }, { highWaterMark: 0 });
        const request = vi.fn().mockResolvedValue(new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        const gateway = new HttpEarlyBirdMembershipGateway({
            baseUrl: 'https://authority.example.test',
            keyId: 'current',
            token: 's'.repeat(43),
        }, request);

        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');
        expect(cancelled).toBe(true);
        expect(pulls).toBe(3);
    });
});
