import { createHmac } from 'node:crypto';

/** The internal service is never addressed with a LiveKit or database identity. */
export function tapestryParticipantId(identity: string, secret = process.env.TAPESTRY_INTERNAL_SECRET ?? ''): string {
    if (!secret) {
        throw new Error('Tapestry is not configured');
    }
    return `tp-${createHmac('sha256', secret).update(`participant:${identity}`).digest('base64url').slice(0, 32)}`;
}

export function tapestryInternalUrl(): string | null {
    const url = process.env.TAPESTRY_INTERNAL_URL;
    const secret = process.env.TAPESTRY_INTERNAL_SECRET;
    return url && secret ? url.replace(/\/$/, '') : null;
}

/** Public display is deliberately off until the consent/caching deployment switch is set. */
export function publicTapestryEnabled(): boolean {
    return process.env.TAPESTRY_PUBLIC_ENABLED === 'true';
}
