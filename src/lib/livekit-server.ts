import { createHmac } from 'node:crypto';

import {
    AccessToken,
    RoomServiceClient,
    TrackSource,
} from 'livekit-server-sdk';

import type { StaffRole } from '@prisma/client';

export type SessionParticipantRole = 'ATTENDEE' | StaffRole;

export type SessionTokenMetadata = {
    role: SessionParticipantRole;
    isAssignedFacilitator: boolean;
};

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// Keep participant identities stable across routine LiveKit API-key rotation.
// The first rollout deliberately falls back to the current API secret so it
// does not rename already connected participants; production then pins the
// separate value for subsequent rotations.
const LIVEKIT_IDENTITY_SECRET = process.env.LIVEKIT_IDENTITY_SECRET || LIVEKIT_API_SECRET;
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

export function getRoomService(requestTimeoutSeconds?: number): RoomServiceClient {
    return requestTimeoutSeconds
        ? new RoomServiceClient(
            getLivekitHttpUrl(),
            LIVEKIT_API_KEY,
            LIVEKIT_API_SECRET,
            { requestTimeout: requestTimeoutSeconds },
        )
        : new RoomServiceClient(getLivekitHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
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
    const digest = createHmac('sha256', LIVEKIT_IDENTITY_SECRET)
        .update(`${scheduledSessionId}:${principalKind}:${principalId}`)
        .digest('base64url')
        .slice(0, 32);
    return `event-${digest}`;
}

/**
 * Rotate a participant onto a fresh, non-PII LiveKit identity whenever a
 * publication grant is revoked. A delayed RPC or previously issued editor JWT
 * can then affect only the fenced identity captured by the outbox, never the
 * participant's current room identity.
 */
export function rotatedRoomIdentity(
    scheduledSessionId: string,
    participantId: string,
    grantVersion: number,
): string {
    requireLiveKitCredentials();
    const digest = createHmac('sha256', LIVEKIT_IDENTITY_SECRET)
        .update(`grant:${scheduledSessionId}:${participantId}:${grantVersion}`)
        .digest('base64url')
        .slice(0, 32);
    return `event-${digest}`;
}

export function bedRoomIdentity(stageIdentity: string): string {
    requireLiveKitCredentials();
    const digest = createHmac('sha256', LIVEKIT_IDENTITY_SECRET)
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
    metadata?: SessionTokenMetadata,
    ttl: string = '4h',
): Promise<string> {
    requireLiveKitCredentials();
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        ttl,
    });

    token.addGrant({
        roomJoin: true,
        room,
        canPublish,
        canPublishSources: canPublish
            ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
            : [],
        // Only the assigned facilitator may emit the small, bounded and
        // identity-free audio-quality snapshot consumed by Staff monitors.
        // Attendees and operational Staff remain unable to publish data.
        canPublishData: metadata?.isAssignedFacilitator === true,
        canSubscribe: true,
    });

    return token.toJwt();
}

export async function createBedToken(
    room: string,
    identity: string,
    ttl?: string,
): Promise<string> {
    return createSessionToken(room, identity, 'Event audio', false, undefined, ttl);
}
