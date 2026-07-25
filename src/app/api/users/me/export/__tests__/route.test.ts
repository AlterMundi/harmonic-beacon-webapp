import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

const ZITADEL_ID = 'zitadel-subject-456';
const DB_USER_ID = 'db-uuid-789';

function mockAuth(role = 'USER') {
    vi.doMock('@/auth', () => ({
        auth: vi.fn().mockResolvedValue({
            user: { id: ZITADEL_ID, email: 'user@example.com', name: 'Test User', role },
        }),
    }));
}

interface PrismaOverrides {
    dbRole?: string;
    listeningSessions?: unknown[];
    favorites?: unknown[];
    participations?: unknown[];
    meditations?: unknown[];
    scheduledSessions?: unknown[];
}

function mockPrismaFor(overrides: PrismaOverrides = {}) {
    const mockPrisma = {
        user: {
            findUnique: vi.fn().mockResolvedValue({
                id: DB_USER_ID,
                email: 'user@example.com',
                name: 'Test User',
                avatarUrl: null,
                role: overrides.dbRole ?? 'LISTENER',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
        },
        listeningSession: {
            findMany: vi.fn().mockResolvedValue(overrides.listeningSessions ?? []),
        },
        favorite: {
            findMany: vi.fn().mockResolvedValue(overrides.favorites ?? []),
        },
        sessionParticipant: {
            findMany: vi.fn().mockResolvedValue(overrides.participations ?? []),
        },
        meditation: {
            findMany: vi.fn().mockResolvedValue(overrides.meditations ?? []),
        },
        scheduledSession: {
            findMany: vi.fn().mockResolvedValue(overrides.scheduledSessions ?? []),
        },
    };
    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    return mockPrisma;
}

describe('GET /api/users/me/export', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 when the user row is missing', async () => {
        mockAuth();
        const mockPrisma = mockPrismaFor();
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });

    it('exports the caller\'s own data and never another user\'s', async () => {
        mockAuth();
        const mockPrisma = mockPrismaFor();

        const { GET } = await import('../route');
        const res = await GET();

        expect(res.status).toBe(200);

        // Looked up by Zitadel subject, not by DB uuid.
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { zitadelId: ZITADEL_ID } }),
        );

        // Every collection query is scoped to the resolved DB user id.
        for (const call of [
            mockPrisma.listeningSession.findMany,
            mockPrisma.favorite.findMany,
            mockPrisma.sessionParticipant.findMany,
        ]) {
            expect(call).toHaveBeenCalledWith(
                expect.objectContaining({ where: { userId: DB_USER_ID } }),
            );
        }
    });

    it('carries a versioned envelope and an attachment filename with the date', async () => {
        mockAuth();
        mockPrismaFor();

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { formatVersion: number; exportedAt: string };
        expect(data.formatVersion).toBe(1);
        expect(data.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        const disposition = res.headers.get('Content-Disposition');
        expect(disposition).toContain('attachment');
        expect(disposition).toContain(`harmonic-beacon-export-${data.exportedAt.slice(0, 10)}.json`);
    });

    it('includes the promised-but-unbuilt categories as empty keys with a note', async () => {
        mockAuth();
        mockPrismaFor();

        const { GET } = await import('../route');
        const res = await GET();
        const { body } = await parseResponse(res);

        const data = body as {
            researchParticipations: unknown[];
            patronage: unknown[];
            notes: Record<string, string>;
        };
        expect(data.researchParticipations).toEqual([]);
        expect(data.patronage).toEqual([]);
        expect(data.notes.unbuiltSurfaces).toMatch(/research/i);
        expect(data.notes.unbuiltSurfaces).toMatch(/patronage/i);
    });

    it('states that audio files are excluded rather than silently omitting them', async () => {
        mockAuth();
        mockPrismaFor();

        const { GET } = await import('../route');
        const res = await GET();
        const { body } = await parseResponse(res);

        const data = body as { notes: Record<string, string> };
        expect(data.notes.audioFiles).toMatch(/not included/i);
    });

    it('resolves meditation titles and leaves tombstoned references null', async () => {
        mockAuth();
        mockPrismaFor({
            listeningSessions: [
                {
                    id: 'ls-1',
                    type: 'MEDITATION',
                    meditationId: 'med-1',
                    meditation: { title: 'Morning Calm' },
                    scheduledSessionId: null,
                    durationSeconds: 600,
                    completed: true,
                    startedAt: new Date('2026-02-01T00:00:00.000Z'),
                    endedAt: new Date('2026-02-01T00:10:00.000Z'),
                },
                {
                    id: 'ls-2',
                    type: 'MEDITATION',
                    meditationId: null,
                    meditation: null,
                    scheduledSessionId: null,
                    durationSeconds: 300,
                    completed: false,
                    startedAt: new Date('2026-02-02T00:00:00.000Z'),
                    endedAt: null,
                },
            ],
        });

        const { GET } = await import('../route');
        const res = await GET();
        const { body } = await parseResponse(res);

        const data = body as { listeningSessions: { meditationTitle: string | null }[] };
        expect(data.listeningSessions).toHaveLength(2);
        expect(data.listeningSessions[0].meditationTitle).toBe('Morning Calm');
        expect(data.listeningSessions[1].meditationTitle).toBeNull();
    });

    it('does not query authored content for a listener', async () => {
        mockAuth();
        const mockPrisma = mockPrismaFor({ dbRole: 'LISTENER' });

        const { GET } = await import('../route');
        const res = await GET();
        const { body } = await parseResponse(res);

        expect(res.status).toBe(200);
        expect(mockPrisma.meditation.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.scheduledSession.findMany).not.toHaveBeenCalled();

        const data = body as { authoredMeditations: unknown[]; hostedSessions: unknown[] };
        expect(data.authoredMeditations).toEqual([]);
        expect(data.hostedSessions).toEqual([]);
    });

    it('includes authored meditations and hosted sessions for a provider', async () => {
        mockAuth('PROVIDER');
        const mockPrisma = mockPrismaFor({
            dbRole: 'PROVIDER',
            meditations: [
                {
                    id: 'med-1',
                    title: 'Morning Calm',
                    description: null,
                    durationSeconds: 600,
                    status: 'APPROVED',
                    isPublished: true,
                    isFeatured: false,
                    isHidden: false,
                    createdAt: new Date('2026-01-02T00:00:00.000Z'),
                    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
                },
            ],
            scheduledSessions: [
                {
                    id: 'ss-1',
                    title: 'Evening Circle',
                    description: null,
                    status: 'ENDED',
                    scheduledAt: new Date('2026-01-03T00:00:00.000Z'),
                    startedAt: null,
                    endedAt: null,
                    durationSeconds: null,
                    createdAt: new Date('2026-01-03T00:00:00.000Z'),
                },
            ],
        });

        const { GET } = await import('../route');
        const res = await GET();
        const { body } = await parseResponse(res);

        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { providerId: DB_USER_ID } }),
        );
        expect(mockPrisma.scheduledSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { providerId: DB_USER_ID } }),
        );

        const data = body as {
            authoredMeditations: { title: string }[];
            hostedSessions: { title: string }[];
        };
        expect(data.authoredMeditations[0].title).toBe('Morning Calm');
        expect(data.hostedSessions[0].title).toBe('Evening Circle');
    });

    it('returns 500 without leaking the error when the query fails', async () => {
        mockAuth();
        const mockPrisma = mockPrismaFor();
        mockPrisma.listeningSession.findMany.mockRejectedValue(
            new Error('connect ECONNREFUSED postgresql://app:hunter2@db:5432/beacon'),
        );

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to export account data' });
        expect(JSON.stringify(body)).not.toContain('hunter2');
    });
});
