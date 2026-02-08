import { randomBytes } from 'crypto';

/**
 * Generate a 12-character alphanumeric invite code.
 */
export function generateInviteCode(): string {
    return randomBytes(9)
        .toString('base64url')
        .slice(0, 12);
}

/**
 * Generate a unique room name for a scheduled session.
 * Format: "session-{8 hex chars}"
 */
export function generateRoomName(): string {
    return `session-${randomBytes(4).toString('hex')}`;
}
