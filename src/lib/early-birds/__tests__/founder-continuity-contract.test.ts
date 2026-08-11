import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { HttpEarlyBirdMembershipGateway } from '../membership-gateway';
import {
    EarlyBirdMembershipContractError,
    authorityMembershipCommand,
    parseCanonicalAuthorityMembershipV3,
    parseMembershipProjectionCommand,
} from '../membership-contract';

const continuity = {
    episode_id: '00000000-0000-4000-8000-000000000101',
    revision: 3,
    state: 'ACTIVE',
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    canonical_price: { currency: 'USD', amount_minor: 500 },
    billing_period: 'MONTHLY',
    activated_at: '2026-08-06T12:00:00Z',
    service_through: '2027-08-08T12:00:00Z',
    ended_at: null,
    terminal_reason: null,
};
const vendoredFixture = JSON.parse(readFileSync(resolve(
    process.cwd(),
    'contracts/early-bird-authority/v3/membership.fixture.json',
), 'utf8')) as Record<string, unknown>;

const active: Record<string, unknown> = {
    schema_version: 'early-bird-authority.membership.v3',
    account_id: 'listener-1',
    membership_revision: 8,
    state: 'ACTIVE',
    source: 'PAYPAL',
    access_allowed: true,
    effective_at: '2026-08-08T12:00:00Z',
    paid_through: '2027-08-08T12:00:00Z',
    grace_until: null,
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    provider: 'paypal',
    current_price: { currency: 'USD', amount_minor: 500 },
    free_entitlement_consumed: true,
    reason_code: 'PAYMENT_SUCCEEDED',
    founder_continuity: continuity,
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

describe('canonical Founder continuity contracts', () => {
    it('parses current, ended tombstone and non-Founder snapshots', () => {
        expect(parseCanonicalAuthorityMembershipV3(vendoredFixture).founder_continuity)
            .toMatchObject({ state: 'ENDED', terminal_reason: 'PERIOD_ENDED' });
        expect(parseCanonicalAuthorityMembershipV3(active).founder_continuity)
            .toMatchObject({ state: 'ACTIVE', activated_at: '2026-08-06T12:00:00.000Z' });

        const ended = parseCanonicalAuthorityMembershipV3({
            ...active,
            state: 'EXPIRED',
            access_allowed: false,
            paid_through: '2026-08-09T12:00:00Z',
            reason_code: 'SERVICE_ENDED',
            founder_continuity: {
                ...continuity,
                revision: 4,
                state: 'ENDED',
                service_through: '2026-08-09T12:00:00Z',
                ended_at: '2026-08-09T12:00:00Z',
                terminal_reason: 'SERVICE_ENDED',
            },
        });
        expect(ended.founder_continuity?.state).toBe('ENDED');

        expect(parseCanonicalAuthorityMembershipV3({
            ...active,
            state: 'ACTIVE',
            source: 'FREE',
            provider: null,
            paid_through: null,
            current_price: null,
            founder_continuity: null,
        }).founder_continuity).toBeNull();
    });

    it.each([
        ['extra top-level field', { ...active, email: 'private@example.invalid' }],
        ['missing continuity', Object.fromEntries(Object.entries(active).filter(([key]) => key !== 'founder_continuity'))],
        ['wrong amount', { ...active, founder_continuity: { ...continuity, canonical_price: { currency: 'USD', amount_minor: 700 } } }],
        ['invalid episode', { ...active, founder_continuity: { ...continuity, episode_id: 'provider-subscription-id' } }],
        ['ended without tombstone', { ...active, state: 'EXPIRED', access_allowed: false, founder_continuity: { ...continuity, state: 'ENDED' } }],
        ['current with terminal evidence', { ...active, founder_continuity: { ...continuity, ended_at: '2026-08-09T12:00:00Z', terminal_reason: 'ENDED' } }],
        ['paid access without continuity', { ...active, founder_continuity: null }],
        ['continuity on Free', { ...active, source: 'FREE', provider: null }],
        ['state mismatch', { ...active, state: 'GRACE', grace_until: '2027-08-08T12:00:00Z' }],
        ['boundary mismatch', { ...active, paid_through: '2027-09-08T12:00:00Z' }],
    ])('rejects %s', (_label, payload) => {
        expect(() => parseCanonicalAuthorityMembershipV3(payload))
            .toThrow(EarlyBirdMembershipContractError);
    });

    it('produces only command v2 and rejects command v1', () => {
        const membership = parseCanonicalAuthorityMembershipV3(active);
        const command = authorityMembershipCommand(membership);
        expect(command).toMatchObject({
            schema_version: 'early-bird-membership.command.v2',
            founder_continuity: { episode_id: continuity.episode_id, state: 'ACTIVE' },
        });
        expect(parseMembershipProjectionCommand(command)).toEqual(command);
        expect(() => parseMembershipProjectionCommand({
            ...command,
            schema_version: 'early-bird-membership.command.v1',
        })).toThrow(EarlyBirdMembershipContractError);
    });

    it('uses the exact private v3 GET and rejects mismatches or oversized bodies', async () => {
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
            'http://pmp-myth-api:8765/api/internal/v3/early-bird-memberships/listener-1',
            expect.objectContaining({ method: 'GET', redirect: 'error', cache: 'no-store' }),
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
        await expect(gateway.readMembership('listener-1')).resolves.toEqual({ ok: false, reason: 'not-found' });
        expect(notFound.wasCancelled()).toBe(true);

        const unauthorized = cancellableResponse(401);
        request.mockResolvedValueOnce(unauthorized.response);
        await expect(gateway.readMembership('listener-1')).rejects.toThrow('unavailable');
        expect(unauthorized.wasCancelled()).toBe(true);
    });
});
