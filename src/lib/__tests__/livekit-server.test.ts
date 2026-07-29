import { beforeEach, describe, expect, it, vi } from 'vitest';

const addGrant = vi.fn();
const toJwt = vi.fn().mockResolvedValue('jwt');

vi.mock('livekit-server-sdk', () => ({
    AccessToken: vi.fn(function (this: Record<string, unknown>) {
        this.addGrant = addGrant;
        this.toJwt = toJwt;
    }),
    RoomServiceClient: vi.fn(function () {}),
    TrackSource: {
        MICROPHONE: 2,
        CAMERA: 1,
    },
}));

describe('livekit-server', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env.LIVEKIT_API_KEY = 'key';
        process.env.LIVEKIT_API_SECRET = 'secret-long-enough';
    });

    it('creates a stable event identity and a distinct stable bed identity', async () => {
        const { bedRoomIdentity, stableRoomIdentity } = await import('../livekit-server');
        const first = stableRoomIdentity('event-1', 'ticket', 'ticket-1');
        const refresh = stableRoomIdentity('event-1', 'ticket', 'ticket-1');
        const otherEvent = stableRoomIdentity('event-2', 'ticket', 'ticket-1');

        expect(first).toBe(refresh);
        expect(first).not.toBe(otherEvent);
        expect(first).toMatch(/^event-[A-Za-z0-9_-]{32}$/);
        expect(bedRoomIdentity(first)).toMatch(/^bed-[A-Za-z0-9_-]{32}$/);
        expect(first).not.toContain('ticket-1');
    });

    it('limits publishing grants to microphone and camera', async () => {
        const { createSessionToken } = await import('../livekit-server');
        await createSessionToken('stage', 'identity', 'Attendee', true);

        expect(addGrant).toHaveBeenCalledWith({
            roomJoin: true,
            room: 'stage',
            canPublish: true,
            canPublishSources: [2, 1],
            canPublishData: false,
            canSubscribe: true,
        });
    });

    it('makes the bed strictly subscribe-only', async () => {
        const { createBedToken } = await import('../livekit-server');
        await createBedToken('beacon', 'bed-identity');

        expect(addGrant).toHaveBeenCalledWith(expect.objectContaining({
            room: 'beacon',
            canPublish: false,
            canPublishSources: [],
            canSubscribe: true,
        }));
    });
});
