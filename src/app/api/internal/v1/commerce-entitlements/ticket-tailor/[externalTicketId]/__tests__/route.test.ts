import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    apply: vi.fn(),
    get: vi.fn(),
}));

vi.mock('@/lib/commerce-service-auth', () => ({
    authorizeCommerceService: mocks.authorize,
}));
vi.mock('@/lib/commerce-entitlement', () => ({
    applyCommerceCommand: mocks.apply,
    getCommerceEntitlement: mocks.get,
}));

import { GET, PUT } from '../route';

const EXTERNAL_TICKET = 'tt-ticket-route-1';
const command = {
    schema_version: 'commerce-entitlement.command.v1',
    request_id: '40000000-0000-4000-8000-000000000001',
    source: 'PMP_MYTH_BOT',
    provider: 'TICKET_TAILOR',
    provision_revision: 1,
    desired_provider_state: 'ACTIVE',
    reason_code: 'PAYMENT_VERIFIED',
    external_order_id: 'tt-order-route-1',
    external_ticket_id: EXTERNAL_TICKET,
    registration_id: '20000000-0000-4000-8000-000000000002',
    scheduled_session_id: '10000000-0000-4000-8000-000000000001',
    bound_email: 'person@example.com',
    tier: 'GLOBAL_SOUTH',
    provider_observed_at: '2026-08-01T04:00:00.000Z',
    grant: {
        grant_id: '30000000-0000-4000-8000-000000000003',
        generation: 1,
        derivation_key_version: 1,
        code: 'HB1-ABCD-EFGH-JKMP-QRST-UVWX-YZ23-4567-89AB',
    },
};
const result = {
    schema_version: 'commerce-entitlement.result.v1',
    entitlement_id: '50000000-0000-4000-8000-000000000005',
    outcome: 'APPLIED',
    applied_revision: 1,
    provider_state: 'ACTIVE',
    administrative_state: 'CLEAR',
    effective_state: 'ACTIVE',
    credential_action: 'CREATED',
    credential_binding: {
        grant_id: command.grant.grant_id,
        generation: 1,
        derivation_key_version: 1,
    },
    web_sessions_revoked_on_apply: 0,
    media_disconnection: { status: 'NOT_REQUIRED', stage_removed: 0, bed_removed: 0 },
    reconciliation_required: false,
};

function put(body: unknown = command, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`http://beacon-app:3000/api/internal/v1/commerce-entitlements/ticket-tailor/${EXTERNAL_TICKET}`, {
        method: 'PUT',
        headers: {
            authorization: 'Bearer secret-not-logged',
            'x-hb-service-key-id': 'current',
            'idempotency-key': `beacon-entitlement:ticket-tailor:${EXTERNAL_TICKET}:1`,
            'content-type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

const params = { params: Promise.resolve({ externalTicketId: EXTERNAL_TICKET }) };

describe('private commerce entitlement route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockReturnValue(true);
        mocks.apply.mockResolvedValue(result);
        mocks.get.mockResolvedValue(result);
    });

    it('authenticates and applies a strictly validated command without caching', async () => {
        const response = await PUT(put(), params);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual(result);
        expect(mocks.apply).toHaveBeenCalledWith(
            expect.objectContaining({ bound_email: 'person@example.com' }),
            EXTERNAL_TICKET,
        );
    });

    it('fails closed before parsing the body when service authentication fails', async () => {
        mocks.authorize.mockReturnValue(false);
        const response = await PUT(put({ secret_material: 'must-not-be-read' }), params);
        expect(response.status).toBe(401);
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({ code: 'unauthorized', retryable: false });
    });

    it('rejects unknown fields and a mismatched idempotency key', async () => {
        const unknown = await PUT(put({ ...command, surprise: true }), params);
        expect(unknown.status).toBe(422);
        expect(await unknown.json()).toMatchObject({ code: 'unknown_field' });

        const mismatch = await PUT(put(command, { 'idempotency-key': 'wrong' }), params);
        expect(mismatch.status).toBe(422);
        expect(await mismatch.json()).toMatchObject({ code: 'idempotency_key_mismatch' });
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it('requires JSON content type before reading a command', async () => {
        const response = await PUT(put(command, { 'content-type': 'text/plain' }), params);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'invalid_request' });
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it('enforces the body limit using bytes and returns a stable envelope', async () => {
        const response = await PUT(put(command, { 'content-length': String(16 * 1024 + 1) }), params);
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
            schema_version: 'commerce-entitlement.error.v1',
            request_id: null,
            code: 'request_too_large',
            message: 'Request body exceeds 16 KiB',
            retryable: false,
        });
    });

    it('returns the current non-secret binding through GET', async () => {
        const request = new NextRequest(`http://beacon-app:3000/api/internal/v1/commerce-entitlements/ticket-tailor/${EXTERNAL_TICKET}`, {
            headers: { authorization: 'Bearer secret-not-logged', 'x-hb-service-key-id': 'current' },
        });
        const response = await GET(request, params);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ credential_binding: { generation: 1 } });
        expect(mocks.get).toHaveBeenCalledWith(EXTERNAL_TICKET);
    });
});
