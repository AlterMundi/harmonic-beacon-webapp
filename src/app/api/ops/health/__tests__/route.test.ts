import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseResponse } from '@/__tests__/helpers';
import type { OperatorHealthReport } from '@/lib/ops-health';

const requireStaff = vi.fn();
const collectOperatorHealth = vi.fn();

vi.mock('@/lib/auth', () => ({ requireStaff }));
vi.mock('@/lib/ops-health', () => ({ collectOperatorHealth }));

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
    });

    it('rejects an unauthenticated caller before running any check', async () => {
        requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        ]);

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET());

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
        expect(collectOperatorHealth).not.toHaveBeenCalled();
    });

    it('rejects a ticket holder — the board names internal infrastructure', async () => {
        requireStaff.mockResolvedValue([
            null,
            NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
        ]);

        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET());

        expect(status).toBe(403);
        expect(collectOperatorHealth).not.toHaveBeenCalled();
    });

    it('returns the full report for staff, always with HTTP 200', async () => {
        requireStaff.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'user-1', role: 'OPERATOR' },
            null,
        ]);

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET());

        expect(status).toBe(200);
        expect(body).toEqual(GREEN_REPORT);
    });

    it('keeps HTTP 200 even when the report is red — the endpoint itself is healthy', async () => {
        requireStaff.mockResolvedValue([
            { kind: 'staff', webSessionId: 'ws-1', userId: 'user-1', role: 'ADMIN' },
            null,
        ]);
        collectOperatorHealth.mockResolvedValue({ ...GREEN_REPORT, status: 'red' });

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET());

        expect(status).toBe(200);
        expect((body as OperatorHealthReport).status).toBe('red');
    });
});
