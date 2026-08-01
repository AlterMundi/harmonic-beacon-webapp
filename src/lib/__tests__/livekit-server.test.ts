import { beforeEach, describe, expect, it, vi } from 'vitest';

const addGrant = vi.fn();
const toJwt = vi.fn().mockResolvedValue('jwt');
const RoomServiceClient = vi.hoisted(() => vi.fn(function () {}));
const AccessToken = vi.hoisted(() => vi.fn(function (
    this: Record<string, unknown>,
    _key: string,
    _secret: string,
    options: Record<string, unknown>,
) {
    this.options = options;
    this.addGrant = addGrant;
    this.toJwt = toJwt;
}));

vi.mock('livekit-server-sdk', () => ({
    AccessToken,
    RoomServiceClient,
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
        delete process.env.LIVEKIT_INTERNAL_URL;
        delete process.env.NEXT_PUBLIC_LIVEKIT_URL;
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
        await createSessionToken('stage', 'identity', 'Ana', true, {
            role: 'ATTENDEE',
            isAssignedFacilitator: false,
        });

        expect(AccessToken).toHaveBeenCalledWith(
            'key',
            'secret-long-enough',
            {
                identity: 'identity',
                name: 'Ana',
                metadata: JSON.stringify({
                    role: 'ATTENDEE',
                    isAssignedFacilitator: false,
                }),
                ttl: '4h',
            },
        );

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

    it('prefers LIVEKIT_INTERNAL_URL for server API calls when it is set', async () => {
        process.env.LIVEKIT_INTERNAL_URL = 'http://livekit:7880';
        const { getRoomService } = await import('../livekit-server');
        getRoomService();

        expect(RoomServiceClient).toHaveBeenCalledWith(
            'http://livekit:7880',
            'key',
            'secret-long-enough',
        );
    });

    it('converts the public wss signaling URL when no internal URL is set', async () => {
        process.env.NEXT_PUBLIC_LIVEKIT_URL = 'wss://live.example.com';
        const { getRoomService } = await import('../livekit-server');
        getRoomService();

        expect(RoomServiceClient).toHaveBeenCalledWith(
            'https://live.example.com',
            'key',
            'secret-long-enough',
        );
    });
});
