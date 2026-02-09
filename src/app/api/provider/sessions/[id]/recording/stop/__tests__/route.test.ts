import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('POST /api/provider/sessions/[id]/recording/stop', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(overrides: {
        session?: Record<string, unknown> | null;
        activeRecordings?: Array<Record<string, unknown>>;
        fileExists?: boolean;
    } = {}) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockStopEgress = vi.fn().mockResolvedValue({});
        const mockEgressClient = { stopEgress: mockStopEgress };

        const recordings = overrides.activeRecordings ?? [
            {
                id: 'rec-1',
                egressId: 'egress-1',
                filePath: '/data/recordings/test.ogg',
                active: true,
                participantIdentity: 'provider-123',
                category: 'SESSION',
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: {
                findUnique: vi.fn().mockResolvedValue(
                    overrides.session !== undefined
                        ? overrides.session
                        : { id: 'sess-1', providerId: 'db-uuid-1', status: 'LIVE' },
                ),
            },
            sessionRecording: {
                findMany: vi.fn().mockResolvedValue(recordings),
                update: vi.fn().mockImplementation(({ where }) => {
                    const rec = recordings.find((r) => r.id === where.id);
                    return Promise.resolve(rec ? { ...rec, active: false } : null);
                }),
                delete: vi.fn().mockResolvedValue({}),
            },
        };

        const fileExists = overrides.fileExists ?? true;
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn().mockReturnValue(mockEgressClient),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(fileExists),
        }));

        return { mockPrisma, mockEgressClient };
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        vi.doMock('@/lib/db', () => ({
            prisma: {
                user: { findUnique: vi.fn() },
                scheduledSession: { findUnique: vi.fn() },
                sessionRecording: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
            },
        }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn(),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/stop', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('stops all active egresses and returns recordings', async () => {
        const { mockEgressClient } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/stop', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { ok: boolean; recordings: Array<{ id: string; participantIdentity: string; category: string }> };
        expect(data.ok).toBe(true);
        expect(data.recordings).toBeDefined();
        expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('egress-1');
    });

    it('marks recordings as inactive when file exists', async () => {
        const { mockPrisma } = setupMocks({ fileExists: true });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/stop', {
            method: 'POST',
        });
        await POST(request, mockParams({ id: 'sess-1' }));

        expect(mockPrisma.sessionRecording.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'rec-1' },
                data: { active: false, stoppedAt: expect.any(Date) },
            }),
        );
    });

    it('returns 404 for nonexistent session', async () => {
        setupMocks({ session: null });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/nonexistent/recording/stop', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 400 when no recordings are active', async () => {
        setupMocks({ activeRecordings: [] });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/stop', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'No recording in progress' });
    });
});
