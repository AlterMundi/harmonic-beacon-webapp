import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/provider/sessions/[id]/invites', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            scheduledSession: { findUnique: vi.fn() },
            sessionInvite: { findMany: vi.fn(), create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn().mockReturnValue('ABC123DEFGH1'),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites');
        const response = await GET(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns invites for a session owned by the provider', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockInvites = [
            { id: 'inv-1', code: 'ABC123', sessionId: 'sess-1', maxUses: 10, usedCount: 3, expiresAt: null, createdAt: new Date() },
            { id: 'inv-2', code: 'DEF456', sessionId: 'sess-1', maxUses: 0, usedCount: 0, expiresAt: null, createdAt: new Date() },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue({ providerId: 'db-uuid-1' }) },
            sessionInvite: { findMany: vi.fn().mockResolvedValue(mockInvites), create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn(),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites');
        const response = await GET(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { invites: Array<{ id: string; code: string }> };
        expect(data.invites).toHaveLength(2);
        expect(data.invites[0].code).toBe('ABC123');

        expect(mockPrisma.sessionInvite.findMany).toHaveBeenCalledWith({
            where: { sessionId: 'sess-1' },
            orderBy: { createdAt: 'desc' },
        });
    });
});

describe('POST /api/provider/sessions/[id]/invites', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            scheduledSession: { findUnique: vi.fn() },
            sessionInvite: { create: vi.fn(), findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn(),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites', {
            method: 'POST',
            body: {},
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('creates invite with generated code', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const createdInvite = {
            id: 'inv-new',
            code: 'GENERATED123',
            sessionId: 'sess-1',
            maxUses: 5,
            expiresAt: null,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', providerId: 'db-uuid-1', status: 'SCHEDULED' }) },
            sessionInvite: {
                create: vi.fn().mockResolvedValue(createdInvite),
                findMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn().mockReturnValue('GENERATED123'),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites', {
            method: 'POST',
            body: { maxUses: 5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(201);
        const data = body as { invite: { id: string; code: string } };
        expect(data.invite.code).toBe('GENERATED123');

        expect(mockPrisma.sessionInvite.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                code: 'GENERATED123',
                sessionId: 'sess-1',
                maxUses: 5,
            }),
        });
    });

    it('returns 403 when provider does not own the session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'my-db-uuid' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', providerId: 'other-uuid', status: 'SCHEDULED' }) },
            sessionInvite: { create: vi.fn(), findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn(),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites', {
            method: 'POST',
            body: { maxUses: 1 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });

    it('returns 400 when session is ENDED or CANCELLED', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', providerId: 'db-uuid-1', status: 'ENDED' }) },
            sessionInvite: { create: vi.fn(), findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateInviteCode: vi.fn(),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/invites', {
            method: 'POST',
            body: { maxUses: 1 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Cannot create invites for ended or cancelled sessions' });
    });
});
