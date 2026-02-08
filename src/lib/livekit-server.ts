import { AccessToken, RoomServiceClient, EgressClient } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://live.altermundi.net';

function getLivekitHttpUrl(): string {
    // Convert wss:// to https:// for API calls
    return LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
}

export function getRoomService(): RoomServiceClient {
    return new RoomServiceClient(getLivekitHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

export function getEgressClient(): EgressClient {
    return new EgressClient(getLivekitHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

/**
 * Create a LiveKit access token for a scheduled session room.
 */
export async function createSessionToken(
    room: string,
    identity: string,
    name: string,
    canPublish: boolean,
): Promise<string> {
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name,
        ttl: '4h',
    });

    token.addGrant({
        roomJoin: true,
        room,
        canPublish,
        canSubscribe: true,
    });

    return token.toJwt();
}
