import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';
import type { OperatorHealthReport } from '@/lib/ops-health';

const requireStaffCapability = vi.fn();
const collectOperatorHealth = vi.fn();
const productionDeps = vi.fn(() => ({ selected: true }));
const findUnique = vi.fn();

vi.mock('@/lib/auth', () => ({ requireStaffCapability }));
vi.mock('@/lib/db', () => ({ prisma: { scheduledSession: { findUnique } } }));
vi.mock('@/lib/ops-health', () => ({ collectOperatorHealth, productionDeps }));

const GREEN_REPORT: OperatorHealthReport = {
    status: 'green',
    checkedAt: '2026-07-30T12:00:00.000Z',
    session: { id: 'session-1', title: 'Saturday EN session', status: 'LIVE' },
    checks: {
        postgres: { status: 'green', detail: 'PostgreSQL answered SELECT 1', latencyMs: 4 },
        livekit: { status: 'green', detail: 'LiveKit API answered (2 room(s))', latencyMs: 12 },
        stageRoom: { status: 'green', detail: 'Stage room exists', latencyMs: 0 },
        publisherGrants: { status: 'green', detail: '6/6 active publish grants', latencyMs: 3 },
        bedPublisher: { status: 'green', detail: 'Bed publisher live', latencyMs: 9 },
        tapestry: { status: 'green', detail: 'Tapestry health endpoint answered', latencyMs: 5 },
    },
};

describe('GET /api/ops/health', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        collectOperatorHealth.mockResolvedValue(GREEN_REPORT);
        productionDeps.mockReturnValue({ selected: true });
        findUnique.mockResolvedValue({
            facilitatorId: 'facilitator-1',
            status: 'LIVE',
        });
    });

    it('rejects an unauthenticated caller before running any check', async () => {
        requireStaffCapability.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        ]);

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(createRequest('/api/ops/health')));

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
        expect(collectOperatorHealth).not.toHaveBeenCalled();
    });

    it('rejects a ticket holder — the board names internal infrastructure', async () => {
        requireStaffCapability.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
        ]);

        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET(createRequest('/api/ops/health')));

        expect(status).toBe(403);
        expect(collectOperatorHealth).not.toHaveBeenCalled();
    });

    it('returns the full report for staff, always with HTTP 200', async () => {
        requireStaffCapability.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'user-1', role: 'OPERATOR' },
            null,
        ]);

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(createRequest('/api/ops/health')));

        expect(status).toBe(200);
        expect(body).toEqual(GREEN_REPORT);
        expect(requireStaffCapability).toHaveBeenCalledWith('view_operations_health');
    });

    it('keeps HTTP 200 even when the report is red — the endpoint itself is healthy', async () => {
        requireStaffCapability.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'user-1', role: 'ADMIN' },
            null,
        ]);
        collectOperatorHealth.mockResolvedValue({ ...GREEN_REPORT, status: 'red' });

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(createRequest('/api/ops/health')));

        expect(status).toBe(200);
        expect((body as OperatorHealthReport).status).toBe('red');
    });

    it('watches an explicitly selected event', async () => {
        requireStaffCapability.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'user-1', role: 'OPERATOR' },
            null,
        ]);
        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET(
            createRequest('/api/ops/health?sessionId=session-2'),
        ));

        expect(status).toBe(200);
        expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'session-2' },
        }));
        expect(productionDeps).toHaveBeenCalledWith({ sessionId: 'session-2' });
        expect(collectOperatorHealth).toHaveBeenCalledWith({ selected: true });
    });

    it('prevents a facilitator from inspecting another event', async () => {
        requireStaffCapability.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'facilitator-2', role: 'FACILITATOR' },
            null,
        ]);
        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET(
            createRequest('/api/ops/health?sessionId=session-1'),
        ));

        expect(status).toBe(403);
        expect(collectOperatorHealth).not.toHaveBeenCalled();
    });

    it('lets FACILITATOR_OP inspect an unassigned event through the central event policy', async () => {
        requireStaffCapability.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'facilitator-op-2', role: 'FACILITATOR_OP' },
            null,
        ]);

        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET(
            createRequest('/api/ops/health?sessionId=session-1'),
        ));

        expect(status).toBe(200);
        expect(collectOperatorHealth).toHaveBeenCalledWith({ selected: true });
    });
});
