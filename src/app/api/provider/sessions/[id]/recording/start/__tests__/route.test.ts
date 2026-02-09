import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('POST /api/provider/sessions/[id]/recording/start', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(overrides: {
        session?: Record<string, unknown> | null;
        existingActive?: Record<string, unknown> | null;
        participants?: Array<Record<string, unknown>>;
        beaconParticipants?: Array<Record<string, unknown>>;
        egressResult?: Record<string, unknown>;
        pollStatus?: number;
    } = {}) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockStartTrackEgress = vi.fn().mockResolvedValue(
            overrides.egressResult ?? { egressId: 'egress-new-1' },
        );
        const mockStopEgress = vi.fn().mockResolvedValue({});
        // pollStatus: 1 = ACTIVE
        const mockListEgress = vi.fn().mockResolvedValue([
            { status: overrides.pollStatus ?? 1 },
        ]);

        const mockEgressClient = {
            startTrackEgress: mockStartTrackEgress,
            stopEgress: mockStopEgress,
            listEgress: mockListEgress,
        };

        // Default: session room has one publisher, beacon room has beacon01
        const sessionParticipants = overrides.participants ?? [
            {
                identity: 'provider-123',
                tracks: [
                    { type: 0 /* AUDIO */, muted: false, sid: 'track-sess-1' },
                ],
            },
        ];
        const beaconParticipants = overrides.beaconParticipants ?? [
            {
                identity: 'beacon01',
                tracks: [
                    { type: 0 /* AUDIO */, muted: false, sid: 'track-beacon-1' },
                ],
            },
        ];

        const mockRoomService = {
            listParticipants: vi.fn().mockImplementation((roomName: string) => {
                if (roomName === 'beacon') return Promise.resolve(beaconParticipants);
                return Promise.resolve(sessionParticipants);
            }),
        };

        const createdRecordings = [
            {
                id: 'rec-new-1',
                participantIdentity: 'provider-123',
                category: 'SESSION',
                egressId: 'egress-new-1',
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: {
                findUnique: vi.fn().mockResolvedValue(
                    overrides.session !== undefined
                        ? overrides.session
                        : {
                              id: 'sess-1',
                              providerId: 'db-uuid-1',
                              status: 'LIVE',
                              roomName: 'session-abc12345',
                          },
                ),
            },
            sessionRecording: {
                findFirst: vi.fn().mockResolvedValue(overrides.existingActive ?? null),
                create: vi.fn().mockImplementation(({ data }) =>
                    Promise.resolve({ id: 'rec-new-1', ...data }),
                ),
            },
            $transaction: vi.fn().mockResolvedValue(createdRecordings),
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn().mockReturnValue(mockEgressClient),
            getRoomService: vi.fn().mockReturnValue(mockRoomService),
        }));
        // Mock livekit-server-sdk for DirectFileOutput and TrackType
        vi.doMock('livekit-server-sdk', () => ({
            DirectFileOutput: vi.fn().mockImplementation(function (this: Record<string, unknown>, { filepath }: { filepath: string }) {
                this.filepath = filepath;
            }),
            TrackType: { AUDIO: 0, VIDEO: 1, DATA: 2 },
        }));

        return { mockPrisma, mockEgressClient, mockRoomService };
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        vi.doMock('@/lib/db', () => ({
            prisma: {
                user: { findUnique: vi.fn() },
                scheduledSession: { findUnique: vi.fn() },
                sessionRecording: { findFirst: vi.fn(), create: vi.fn() },
                $transaction: vi.fn(),
            },
        }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
            getRoomService: vi.fn(),
        }));
        vi.doMock('livekit-server-sdk', () => ({
            DirectFileOutput: vi.fn(),
            TrackType: { AUDIO: 0 },
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 for nonexistent session', async () => {
        setupMocks({ session: null });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/nonexistent/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 403 when provider does not own the session', async () => {
        setupMocks({
            session: { id: 'sess-1', providerId: 'other-provider-uuid', status: 'LIVE', roomName: 'session-abc' },
        });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });

    it('starts track egress and creates SessionRecording rows', async () => {
        const { mockPrisma, mockEgressClient } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { recordings: Array<{ id: string; participantIdentity: string; category: string }> };
        expect(data.recordings).toBeDefined();
        expect(data.recordings.length).toBeGreaterThan(0);

        // Verify egress was started
        expect(mockEgressClient.startTrackEgress).toHaveBeenCalled();

        // Verify recording rows were created via $transaction
        expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('returns 409 when recordings are already active', async () => {
        setupMocks({
            existingActive: { id: 'rec-existing', active: true },
        });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(409);
        expect(body).toEqual({ error: 'Recording already in progress' });
    });

    it('returns 400 when no audio tracks are available', async () => {
        setupMocks({
            participants: [],
            beaconParticipants: [],
        });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'No audio tracks found to record' });
    });

    it('creates SessionRecording rows in a transaction', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/recording/start', {
            method: 'POST',
        });
        await POST(request, mockParams({ id: 'sess-1' }));

        // $transaction is called with an array of prisma.sessionRecording.create calls
        expect(mockPrisma.$transaction).toHaveBeenCalledWith(
            expect.arrayContaining([expect.any(Promise)]),
        );
    });
});
