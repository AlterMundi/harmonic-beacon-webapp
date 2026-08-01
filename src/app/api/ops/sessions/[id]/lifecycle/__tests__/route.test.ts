import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';
import { SessionLifecycleError } from '@/lib/session-lifecycle';

const { resolveStaffSession, transitionScheduledSession } = vi.hoisted(() => ({
    resolveStaffSession: vi.fn(),
    transitionScheduledSession: vi.fn(),
}));

vi.mock('@/lib/ops-auth', () => ({ resolveStaffSession }));
vi.mock('@/lib/session-lifecycle', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/session-lifecycle')>();
    return { ...original, transitionScheduledSession };
});

describe('POST /api/ops/sessions/[id]/lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveStaffSession.mockResolvedValue({
            id: 'operator-1',
            role: 'OPERATOR',
            name: 'Op',
            email: 'op@example.com',
        });
        transitionScheduledSession.mockResolvedValue({
            changed: true,
            previousStatus: 'SCHEDULED',
            status: 'LIVE',
            startedAt: new Date('2026-08-01T18:00:00Z'),
            endedAt: null,
        });
    });

    it('requires a current staff session', async () => {
        resolveStaffSession.mockResolvedValue(null);
        const { POST } = await import('../route');
        const response = await POST(
            createRequest('/api/ops/sessions/event-1/lifecycle', {
                method: 'POST',
                body: { status: 'LIVE' },
            }),
            mockParams({ id: 'event-1' }),
        );
        expect((await parseResponse(response)).status).toBe(401);
        expect(transitionScheduledSession).not.toHaveBeenCalled();
    });

    it('validates the target status before mutation', async () => {
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            createRequest('/api/ops/sessions/event-1/lifecycle', {
                method: 'POST',
                body: { status: 'PAUSED' },
            }),
            mockParams({ id: 'event-1' }),
        ));
        expect(status).toBe(400);
        expect(body).toMatchObject({ error: 'invalid_request' });
    });

    it('returns the audited transition result', async () => {
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            createRequest('/api/ops/sessions/event-1/lifecycle', {
                method: 'POST',
                body: { status: 'LIVE', reason: 'Doors ready' },
            }),
            mockParams({ id: 'event-1' }),
        ));
        expect(status).toBe(200);
        expect(body).toMatchObject({ changed: true, status: 'LIVE' });
        expect(transitionScheduledSession).toHaveBeenCalledWith({
            sessionId: 'event-1',
            actor: expect.objectContaining({ id: 'operator-1' }),
            targetStatus: 'LIVE',
            reason: 'Doors ready',
        });
    });

    it('preserves lifecycle conflict semantics', async () => {
        transitionScheduledSession.mockRejectedValue(
            new SessionLifecycleError(409, 'invalid_transition', 'Already ended'),
        );
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            createRequest('/api/ops/sessions/event-1/lifecycle', {
                method: 'POST',
                body: { status: 'LIVE' },
            }),
            mockParams({ id: 'event-1' }),
        ));
        expect(status).toBe(409);
        expect(body).toEqual({ error: 'invalid_transition', message: 'Already ended' });
    });
});
