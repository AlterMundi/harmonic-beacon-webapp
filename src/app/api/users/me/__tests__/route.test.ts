import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/users/me', () => {
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

    it('returns 404 when user not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });

    it('returns user profile with stats', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-user-1',
                    name: 'Test User',
                    email: 'user@example.com',
                    avatarUrl: 'https://example.com/avatar.png',
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(5),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: 3600 } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(3),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            user: { name: string; email: string; avatarUrl: string; role: string };
            stats: { totalSessions: number; totalMinutes: number; favoritesCount: number };
        };

        expect(data.user).toEqual({
            name: 'Test User',
            email: 'user@example.com',
            avatarUrl: 'https://example.com/avatar.png',
            role: 'USER',
        });
        expect(data.stats).toEqual({
            totalSessions: 5,
            totalMinutes: 60,
            favoritesCount: 3,
        });
    });

    it('returns stats with zero values for new user', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'New User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-user-1',
                    name: 'New User',
                    email: 'user@example.com',
                    avatarUrl: null,
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(0),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: null } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(0),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            stats: { totalSessions: number; totalMinutes: number; favoritesCount: number };
        };

        expect(data.stats).toEqual({
            totalSessions: 0,
            totalMinutes: 0,
            favoritesCount: 0,
        });
    });

    it('looks up user by zitadelId (not DB id)', async () => {
        const zitadelId = 'zitadel-subject-456';

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: zitadelId, email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-uuid-789',
                    name: 'Test User',
                    email: 'user@example.com',
                    avatarUrl: null,
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(0),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: null } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(0),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        await GET();

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId },
            select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                role: true,
            },
        });
    });
});

interface DeleteMockOptions {
    dbUserId?: string;
    meditationCount?: number;
    scheduledSessionCount?: number;
}

function mockDeletePrisma(options: DeleteMockOptions = {}) {
    const mockPrisma = {
        user: {
            findUnique: vi.fn().mockResolvedValue({ id: options.dbUserId ?? 'db-user-1' }),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
        },
        favorite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        listeningSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        sessionParticipant: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        meditation: {
            count: vi.fn().mockResolvedValue(options.meditationCount ?? 0),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        scheduledSession: {
            count: vi.fn().mockResolvedValue(options.scheduledSessionCount ?? 0),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: vi.fn().mockResolvedValue([]),
    };
    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    return mockPrisma;
}

function mockDeleteAuth(zitadelId = 'zitadel-user-123') {
    vi.doMock('@/auth', () => ({
        auth: vi.fn().mockResolvedValue({
            user: { id: zitadelId, email: 'user@example.com', name: 'Test User', role: 'USER' },
        }),
    }));
}

describe('DELETE /api/users/me', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { DELETE } = await import('../route');
        const res = await DELETE();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 when the user row is missing', async () => {
        mockDeleteAuth();
        const mockPrisma = mockDeletePrisma();
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const { DELETE } = await import('../route');
        const res = await DELETE();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });

    it('anonymises the user row instead of deleting it', async () => {
        mockDeleteAuth();
        const mockPrisma = mockDeletePrisma();

        const { DELETE } = await import('../route');
        const res = await DELETE();

        expect(res.status).toBe(200);
        expect(mockPrisma.user.delete).not.toHaveBeenCalled();
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'db-user-1' },
            data: expect.objectContaining({
                name: null,
                avatarUrl: null,
                role: 'LISTENER',
                deletedAt: expect.any(Date),
            }),
        });

        const data = mockPrisma.user.update.mock.calls[0][0].data;
        expect(data.email).not.toBe('user@example.com');
        expect(data.zitadelId).not.toBe('zitadel-user-123');
    });

    it('deletes favourites, listening history and participation in one transaction', async () => {
        mockDeleteAuth();
        const mockPrisma = mockDeletePrisma();

        const { DELETE } = await import('../route');
        await DELETE();

        expect(mockPrisma.favorite.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'db-user-1' },
        });
        expect(mockPrisma.listeningSession.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'db-user-1' },
        });
        expect(mockPrisma.sessionParticipant.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'db-user-1' },
        });
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(4);
    });

    it('derives unique placeholders so two deletions cannot collide', async () => {
        // The email and zitadel_id columns are @unique. A constant placeholder
        // would pass the first deletion and fail the second on a unique
        // violation, in production, with the account already half-purged.
        mockDeleteAuth('zitadel-user-a');
        const prismaA = mockDeletePrisma({ dbUserId: 'db-user-a' });
        const first = await import('../route');
        await first.DELETE();
        const firstData = prismaA.user.update.mock.calls[0][0].data;

        vi.resetModules();

        mockDeleteAuth('zitadel-user-b');
        const prismaB = mockDeletePrisma({ dbUserId: 'db-user-b' });
        const second = await import('../route');
        await second.DELETE();
        const secondData = prismaB.user.update.mock.calls[0][0].data;

        expect(firstData.email).not.toBe(secondData.email);
        expect(firstData.zitadelId).not.toBe(secondData.zitadelId);
        expect(firstData.email).toContain('db-user-a');
        expect(secondData.email).toContain('db-user-b');
    });

    it('anonymises a provider without deleting their authored content', async () => {
        mockDeleteAuth();
        const mockPrisma = mockDeletePrisma({ meditationCount: 2, scheduledSessionCount: 1 });

        const { DELETE } = await import('../route');
        const res = await DELETE();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.scheduledSession.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.user.update).toHaveBeenCalled();

        const data = body as { authoredContentCount: number; retained: string[] };
        expect(data.authoredContentCount).toBe(3);
        // Asserts the substance rather than a keyword: a Provider deleting their
        // account has to learn that their published work stays up, and that
        // withdrawing it is a separate thing they could have done first. An
        // earlier version of this matched the word "takedown", which passed on
        // wording that told them nothing.
        const authoredNote = data.retained.find((r) => /authored/i.test(r));
        expect(authoredNote).toBeDefined();
        expect(authoredNote).toMatch(/remains published/i);
        expect(authoredNote).toMatch(/does not withdraw/i);
    });

    it('states what was retained and why, including the unpurged audio', async () => {
        mockDeleteAuth();
        mockDeletePrisma();

        const { DELETE } = await import('../route');
        const res = await DELETE();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { deleted: boolean; deletedData: string[]; retained: string[] };
        expect(data.deleted).toBe(true);
        expect(data.deletedData.length).toBeGreaterThan(0);
        expect(data.retained.some((r) => /anonymised/i.test(r))).toBe(true);
        expect(data.retained.some((r) => /audio is not purged/i.test(r))).toBe(true);
        // No takedown line when the account authored nothing.
        expect(data.retained.some((r) => /takedown/i.test(r))).toBe(false);
    });

    it('returns 500 without leaking the error when the transaction fails', async () => {
        mockDeleteAuth();
        const mockPrisma = mockDeletePrisma();
        mockPrisma.$transaction.mockRejectedValue(
            new Error('connect ECONNREFUSED postgresql://app:hunter2@db:5432/beacon'),
        );

        const { DELETE } = await import('../route');
        const res = await DELETE();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to delete account' });
        expect(JSON.stringify(body)).not.toContain('hunter2');
    });
});
