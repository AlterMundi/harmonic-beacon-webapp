import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('POST /api/scheduled-sessions/[id]/leave', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { POST } = await import('../route');
        const res = await POST(
            createRequest('/api/scheduled-sessions/ss-1/leave', { method: 'POST' }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('records leftAt and calculates duration', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const joinedAt = new Date('2025-01-01T10:00:00Z');

        const mockParticipant = {
            id: 'participant-1',
            sessionId: 'ss-1',
            userId: 'db-user-1',
            joinedAt,
            leftAt: null,
            durationSeconds: null,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(mockParticipant),
                update: vi.fn().mockResolvedValue({}),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(
            createRequest('/api/scheduled-sessions/ss-1/leave', { method: 'POST' }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(body).toEqual({ ok: true });

        // Verify update was called with leftAt and durationSeconds
        expect(mockPrisma.sessionParticipant.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'participant-1' },
                data: expect.objectContaining({
                    leftAt: expect.any(Date),
                    durationSeconds: expect.any(Number),
                }),
            }),
        );
    });

    it('returns 404 when participant not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(null),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(
            createRequest('/api/scheduled-sessions/ss-1/leave', { method: 'POST' }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Not a participant' });
    });

    it('is idempotent when already left (does not recalculate)', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockParticipant = {
            id: 'participant-1',
            sessionId: 'ss-1',
            userId: 'db-user-1',
            joinedAt: new Date('2025-01-01T10:00:00Z'),
            leftAt: new Date('2025-01-01T10:30:00Z'), // already left
            durationSeconds: 1800,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(mockParticipant),
                update: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(
            createRequest('/api/scheduled-sessions/ss-1/leave', { method: 'POST' }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(body).toEqual({ ok: true });

        // update should NOT be called since already left
        expect(mockPrisma.sessionParticipant.update).not.toHaveBeenCalled();
    });
});
