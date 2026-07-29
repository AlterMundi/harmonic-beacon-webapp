import { createHmac } from 'node:crypto';

import {
    AccessToken,
    RoomServiceClient,
    TrackSource,
} from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://live.altermundi.net';
// Server-to-server API endpoint inside the deploy network (compose sets this to
// http://livekit:7880). When present it wins over the public signaling URL:
// the app's API calls should not hairpin through nginx and the public TLS
// endpoint to reach a server on the same docker bridge.
const LIVEKIT_INTERNAL_URL = process.env.LIVEKIT_INTERNAL_URL || '';

function getLivekitHttpUrl(): string {
    if (LIVEKIT_INTERNAL_URL) {
        return LIVEKIT_INTERNAL_URL;
    }
    // Convert wss:// to https:// for API calls
    return LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
}

export function getRoomService(): RoomServiceClient {
    return new RoomServiceClient(getLivekitHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function requireLiveKitCredentials(): void {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('LiveKit API credentials not configured');
    }
}

/**
 * Stable, event-scoped and non-PII. LiveKit replaces an existing participant
 * when another device joins with the same identity, so a second device replaces
 * the first connection instead of creating another floor identity.
 */
export function stableRoomIdentity(
    scheduledSessionId: string,
    principalKind: 'ticket' | 'staff',
    principalId: string,
): string {
    requireLiveKitCredentials();
    const digest = createHmac('sha256', LIVEKIT_API_SECRET)
        .update(`${scheduledSessionId}:${principalKind}:${principalId}`)
        .digest('base64url')
        .slice(0, 32);
    return `event-${digest}`;
}

export function bedRoomIdentity(stageIdentity: string): string {
    requireLiveKitCredentials();
    const digest = createHmac('sha256', LIVEKIT_API_SECRET)
        .update(`bed:${stageIdentity}`)
        .digest('base64url')
        .slice(0, 32);
    return `bed-${digest}`;
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
    requireLiveKitCredentials();
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name,
        ttl: '4h',
    });

    token.addGrant({
        roomJoin: true,
        room,
        canPublish,
        canPublishSources: canPublish
            ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
            : [],
        canPublishData: false,
        canSubscribe: true,
    });

    return token.toJwt();
}

export async function createBedToken(
    room: string,
    identity: string,
): Promise<string> {
    return createSessionToken(room, identity, 'Event audio', false);
}
