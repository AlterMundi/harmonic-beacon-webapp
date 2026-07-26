import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

const ADMIN_SESSION = {
    user: { id: 'zitadel-admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
};

const LIVE_SESSION = {
    id: 'sess-1',
    roomName: 'session-abc12345',
    providerId: 'db-provider-1',
    status: 'LIVE',
    startedAt: new Date(Date.now() - 600 * 1000),
};

const VALID_REASON = 'Hate speech from the host mic, confirmed by two admins.';

function mockAuth(session: unknown) {
    vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(session) }));
}

interface Harness {
    mockPrisma: {
        scheduledSession: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
        sessionParticipant: { count: ReturnType<typeof vi.fn> };
        sessionRecording: {
            findMany: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            delete: ReturnType<typeof vi.fn>;
        };
        user: { findUnique: ReturnType<typeof vi.fn> };
        auditLog: { create: ReturnType<typeof vi.fn> };
    };
    mockDeleteRoom: ReturnType<typeof vi.fn>;
    mockStopEgress: ReturnType<typeof vi.fn>;
}

function setup(
    sessionRow: Record<string, unknown> | null = LIVE_SESSION,
    options: {
        recordings?: Record<string, unknown>[];
        deleteRoomFails?: boolean;
        auditFails?: boolean;
        fileExists?: boolean;
        participants?: number;
    } = {},
): Harness {
    const {
        recordings = [],
        deleteRoomFails = false,
        auditFails = false,
        fileExists = true,
        participants = 3,
    } = options;

    const mockPrisma = {
        scheduledSession: {
            findUnique: vi.fn().mockResolvedValue(sessionRow),
            update: vi.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...LIVE_SESSION, ...sessionRow, ...data }),
            ),
        },
        sessionParticipant: { count: vi.fn().mockResolvedValue(participants) },
        sessionRecording: {
            findMany: vi.fn().mockResolvedValue(recordings),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-admin-1' }) },
        auditLog: {
            create: auditFails
                ? vi.fn().mockRejectedValue(new Error('audit table unreachable'))
                : vi.fn().mockResolvedValue({}),
        },
    };

    const mockDeleteRoom = deleteRoomFails
        ? vi.fn().mockRejectedValue(new Error('room not found'))
        : vi.fn().mockResolvedValue(undefined);
    const mockStopEgress = vi.fn().mockResolvedValue({});

    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    vi.doMock('@/lib/livekit-server', () => ({
        getRoomService: vi.fn().mockReturnValue({ deleteRoom: mockDeleteRoom }),
        getEgressClient: vi.fn().mockReturnValue({ stopEgress: mockStopEgress }),
    }));
    vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(fileExists) }));

    return { mockPrisma, mockDeleteRoom, mockStopEgress };
}

function terminateRequest(body: unknown) {
    return createRequest('/api/admin/sessions/sess-1/terminate', { method: 'POST', body });
}

describe('POST /api/admin/sessions/[id]/terminate', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        mockAuth(null);
        setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for a PROVIDER — the kill switch is not a Provider power', async () => {
        mockAuth({ user: { id: 'zitadel-p-1', email: 'p@example.com', name: 'P', role: 'PROVIDER' } });
        const { mockPrisma, mockDeleteRoom } = setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
        expect(mockDeleteRoom).not.toHaveBeenCalled();
        expect(mockPrisma.scheduledSession.update).not.toHaveBeenCalled();
    });

    it('returns 403 for a LISTENER', async () => {
        mockAuth({ user: { id: 'zitadel-l-1', email: 'l@example.com', name: 'L', role: 'LISTENER' } });
        setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));

        expect(res.status).toBe(403);
    });

    it('refuses without a reason and touches nothing', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma, mockDeleteRoom, mockStopEgress } = setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({}), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'reason is required and must be at least 8 characters' });
        expect(mockPrisma.scheduledSession.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.scheduledSession.update).not.toHaveBeenCalled();
        expect(mockDeleteRoom).not.toHaveBeenCalled();
        expect(mockStopEgress).not.toHaveBeenCalled();
        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('refuses a whitespace-only reason', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockDeleteRoom } = setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: '            ' }), mockParams({ id: 'sess-1' }));

        expect(res.status).toBe(400);
        expect(mockDeleteRoom).not.toHaveBeenCalled();
    });

    it('refuses a reason too short to be an account of anything', async () => {
        mockAuth(ADMIN_SESSION);
        setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: 'abuse' }), mockParams({ id: 'sess-1' }));

        expect(res.status).toBe(400);
    });

    it('refuses a non-string reason', async () => {
        mockAuth(ADMIN_SESSION);
        setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: true }), mockParams({ id: 'sess-1' }));

        expect(res.status).toBe(400);
    });

    it('refuses an oversized reason', async () => {
        mockAuth(ADMIN_SESSION);
        setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: 'x'.repeat(1001) }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'reason must be 1000 characters or fewer' });
    });

    it('ends the session and deletes the LiveKit room', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma, mockDeleteRoom } = setup();

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { terminated: boolean; roomDeleted: boolean; session: { status: string } };
        expect(data.terminated).toBe(true);
        expect(data.roomDeleted).toBe(true);
        expect(data.session.status).toBe('ENDED');

        expect(mockPrisma.scheduledSession.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'sess-1' },
                data: expect.objectContaining({ status: 'ENDED' }),
            }),
        );
        expect(mockDeleteRoom).toHaveBeenCalledWith('session-abc12345');
    });

    it('stops active egress recordings before deleting the room', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma, mockStopEgress } = setup(LIVE_SESSION, {
            recordings: [
                { id: 'rec-1', egressId: 'egress-1', filePath: '/data/recordings/a.ogg', active: true },
                { id: 'rec-2', egressId: 'egress-2', filePath: '/data/recordings/b.ogg', active: true },
            ],
        });

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(mockStopEgress).toHaveBeenCalledWith('egress-1');
        expect(mockStopEgress).toHaveBeenCalledWith('egress-2');
        // Files exist, so the rows are marked stopped rather than deleted.
        expect(mockPrisma.sessionRecording.update).toHaveBeenCalledTimes(2);
        expect(mockPrisma.sessionRecording.delete).not.toHaveBeenCalled();
        expect((body as { recordingsStopped: number }).recordingsStopped).toBe(2);
    }, 10000);

    it('drops a recording row whose file never landed', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma } = setup(LIVE_SESSION, {
            recordings: [{ id: 'rec-1', egressId: 'egress-1', filePath: '/data/recordings/a.ogg', active: true }],
            fileExists: false,
        });

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));

        expect(res.status).toBe(200);
        expect(mockPrisma.sessionRecording.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
        expect(mockPrisma.sessionRecording.update).not.toHaveBeenCalled();
    }, 10000);

    it('writes an audit entry carrying the declared reason and an incident snapshot', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma } = setup(LIVE_SESSION, { participants: 4 });

        const { POST } = await import('../route');
        await POST(terminateRequest({ reason: `  ${VALID_REASON}  ` }), mockParams({ id: 'sess-1' }));

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'session.terminate',
                targetType: 'SESSION',
                targetId: 'sess-1',
                metadata: expect.objectContaining({
                    // Trimmed, so the log holds the reason and not the whitespace.
                    reason: VALID_REASON,
                    roomName: 'session-abc12345',
                    providerId: 'db-provider-1',
                    participantsAtTermination: 4,
                    recordingsStopped: 0,
                    roomDeleted: true,
                }),
            },
        });
    });

    it('records the role snapshot rather than resolving the actor role later', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma } = setup();

        const { POST } = await import('../route');
        await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));

        expect(mockPrisma.auditLog.create.mock.calls[0][0].data.actorRole).toBe('ADMIN');
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId: 'zitadel-admin-1' },
            select: { id: true },
        });
    });

    it('still ends the session when the room deletion fails, and says so', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma } = setup(LIVE_SESSION, { deleteRoomFails: true });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect((body as { roomDeleted: boolean }).roomDeleted).toBe(false);
        expect(mockPrisma.scheduledSession.update).toHaveBeenCalled();
        expect(mockPrisma.auditLog.create.mock.calls[0][0].data.metadata.roomDeleted).toBe(false);
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('still terminates when the audit write fails', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma, mockDeleteRoom } = setup(LIVE_SESSION, { auditFails: true });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect((body as { terminated: boolean }).terminated).toBe(true);
        expect(mockPrisma.scheduledSession.update).toHaveBeenCalled();
        expect(mockDeleteRoom).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('returns 404 for an unknown session', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockDeleteRoom } = setup(null);

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'nope' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
        expect(mockDeleteRoom).not.toHaveBeenCalled();
    });

    it('refuses a session that is not LIVE', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma, mockDeleteRoom } = setup({ ...LIVE_SESSION, status: 'ENDED' });

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Can only terminate a LIVE session' });
        expect(mockDeleteRoom).not.toHaveBeenCalled();
        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns 400 on an unparseable body', async () => {
        mockAuth(ADMIN_SESSION);
        setup();

        const { POST } = await import('../route');
        const res = await POST(
            createRequest('/api/admin/sessions/sess-1/terminate', { method: 'POST' }),
            mockParams({ id: 'sess-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid JSON body' });
    });

    it('does not leak the raw error on a DB failure', async () => {
        mockAuth(ADMIN_SESSION);
        const { mockPrisma } = setup();
        mockPrisma.scheduledSession.update.mockRejectedValue(
            new Error('connect failed: postgresql://beacon:s3cr3t@db:5432/beacon'),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { POST } = await import('../route');
        const res = await POST(terminateRequest({ reason: VALID_REASON }), mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to terminate session' });
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('s3cr3t');

        consoleError.mockRestore();
    });
});
