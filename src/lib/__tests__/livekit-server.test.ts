import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddGrant = vi.fn();
const mockToJwt = vi.fn().mockResolvedValue('mock-jwt');

vi.mock('livekit-server-sdk', () => {
    const MockAccessToken = vi.fn(function (this: Record<string, unknown>) {
        this.addGrant = mockAddGrant;
        this.toJwt = mockToJwt;
    });
    return {
        AccessToken: MockAccessToken,
        RoomServiceClient: vi.fn(function () {}),
        EgressClient: vi.fn(function () {}),
    };
});

import { AccessToken, RoomServiceClient, EgressClient } from 'livekit-server-sdk';
import { getRoomService, getEgressClient, createSessionToken } from '../livekit-server';

describe('getRoomService', () => {
    it('creates RoomServiceClient with https URL from wss', () => {
        getRoomService();
        expect(RoomServiceClient).toHaveBeenCalledWith(
            expect.stringContaining('https://'),
            expect.any(String),
            expect.any(String),
        );
    });

    it('does not contain wss:// in the HTTP URL', () => {
        getRoomService();
        const call = vi.mocked(RoomServiceClient).mock.calls[0];
        expect(call[0]).not.toContain('wss://');
    });
});

describe('getEgressClient', () => {
    it('creates EgressClient with https URL from wss', () => {
        getEgressClient();
        expect(EgressClient).toHaveBeenCalledWith(
            expect.stringContaining('https://'),
            expect.any(String),
            expect.any(String),
        );
    });
});

describe('createSessionToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates AccessToken with correct identity and TTL', async () => {
        await createSessionToken('room-1', 'user-123', 'Test User', true);
        expect(AccessToken).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ identity: 'user-123', name: 'Test User', ttl: '4h' }),
        );
    });

    it('grants room join with canPublish flag', async () => {
        await createSessionToken('room-1', 'user-123', 'Test User', true);
        expect(mockAddGrant).toHaveBeenCalledWith(
            expect.objectContaining({ roomJoin: true, room: 'room-1', canPublish: true, canSubscribe: true }),
        );
    });

    it('passes canPublish=false correctly', async () => {
        await createSessionToken('room-1', 'user-123', 'Listener', false);
        expect(mockAddGrant).toHaveBeenCalledWith(
            expect.objectContaining({ canPublish: false }),
        );
    });

    it('returns JWT string', async () => {
        const token = await createSessionToken('room-1', 'id', 'name', true);
        expect(token).toBe('mock-jwt');
    });
});
