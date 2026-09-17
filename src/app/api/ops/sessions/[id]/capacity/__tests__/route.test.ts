import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaffCapability: vi.fn(),
    setSessionSceneCapacity: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaffCapability: mocks.requireStaffCapability }));
vi.mock('@/lib/session-capacity', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/session-capacity')>();
    return { ...original, setSessionSceneCapacity: mocks.setSessionSceneCapacity };
});

const operator = {
    kind: 'staff',
    webSessionId: 'web-1',
    userId: 'operator-1',
    role: 'FACILITATOR_OP',
};

function request(body: unknown) {
    return createRequest('/api/ops/sessions/event-1/capacity', {
        method: 'PATCH',
        body,
    });
}

describe('PATCH /api/ops/sessions/[id]/capacity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requireStaffCapability.mockResolvedValue([operator, null]);
        mocks.setSessionSceneCapacity.mockResolvedValue({
            scheduledSessionId: 'event-1',
            previousMaxPublishers: 6,
            maxPublishers: 12,
            activePublisherGrants: 5,
            changedAt: new Date('2026-09-16T01:00:00Z'),
        });
    });

    it('changes capacity through the serialized audited service', async () => {
        const { PATCH } = await import('../route');
        const { status, body } = await parseResponse(await PATCH(
            request({ maxPublishers: 12, reason: 'Larger panel' }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            scheduledSessionId: 'event-1',
            previousMaxPublishers: 6,
            maxPublishers: 12,
            activePublisherGrants: 5,
            changedAt: '2026-09-16T01:00:00.000Z',
        });
        expect(mocks.setSessionSceneCapacity).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'FACILITATOR_OP',
            maxPublishers: 12,
            reason: 'Larger panel',
        });
    });

    it('requires staff before invoking the mutation', async () => {
        mocks.requireStaffCapability.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        ]);
        const { PATCH } = await import('../route');
        const response = await PATCH(request({ maxPublishers: 9 }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(401);
        expect(mocks.setSessionSceneCapacity).not.toHaveBeenCalled();
        expect(mocks.requireStaffCapability).toHaveBeenCalledWith('administer_system');
    });

    it.each([
        ['null', 'null'],
        ['array', '[{"maxPublishers":9}]'],
        ['primitive number', '9'],
        ['primitive string', '"9"'],
        ['missing field', '{}'],
        ['malformed JSON', '{"maxPublishers":'],
    ])('rejects %s bodies as invalid_capacity without throwing', async (_label, rawBody) => {
        const { PATCH } = await import('../route');
        const response = await PATCH(
            new NextRequest('http://localhost/api/ops/sessions/event-1/capacity', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: rawBody,
            }),
            mockParams({ id: 'event-1' }),
        );
        const result = await parseResponse(response);

        expect(result.status).toBe(400);
        expect(result.body).toEqual({
            error: 'invalid_capacity',
            message: 'maxPublishers must be one of 6, 9, or 12',
        });
        expect(mocks.setSessionSceneCapacity).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid_capacity', 400],
        ['forbidden', 403],
        ['session_not_found', 404],
        ['capacity_below_active_grants', 409],
    ] as const)('returns the service %s error without hiding occupancy details', async (code, status) => {
        const { SessionCapacityError } = await import('@/lib/session-capacity');
        mocks.setSessionSceneCapacity.mockRejectedValue(new SessionCapacityError(
            code,
            status,
            'Capacity rejected',
            { activePublisherGrants: 7, requestedMaxPublishers: 6 },
        ));
        const { PATCH } = await import('../route');
        const result = await parseResponse(await PATCH(
            request({ maxPublishers: 6 }),
            mockParams({ id: 'event-1' }),
        ));

        expect(result.status).toBe(status);
        expect(result.body).toEqual({
            error: code,
            message: 'Capacity rejected',
            activePublisherGrants: 7,
            requestedMaxPublishers: 6,
        });
    });
});
