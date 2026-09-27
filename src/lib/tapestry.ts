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

/**
 * Call only after room entitlement has succeeded. Recover a missing in-memory
 * registration (new event, idle expiry or service restart), then retry once.
 * Never register on a generic 404: an older service may lack the route itself.
 * The caller supplies replayable bytes, not a consumed request stream.
 */
export async function sendTapestryFrame(
    internalUrl: string,
    sessionId: string,
    participantId: string,
    frame: ArrayBuffer,
): Promise<Response> {
    const sessionUrl = `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}`;
    const secret = process.env.TAPESTRY_INTERNAL_SECRET;
    if (!secret) throw new Error('Tapestry is not configured');
    // One deadline bounds the original request, registration and retry together.
    const signal = AbortSignal.timeout(3_000);
    const send = () => fetch(`${sessionUrl}/participants/${encodeURIComponent(participantId)}/frame`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-tapestry-internal-secret': secret },
        body: frame,
        cache: 'no-store',
        signal,
    });
    const response = await send();
    if (response.status !== 404) return response;
    const reason = await response.clone().json().catch(() => null) as { error?: string } | null;
    if (reason?.error !== 'unknown_session') return response;
    const registration = await fetch(sessionUrl, {
        method: 'PUT',
        headers: { 'x-tapestry-internal-secret': secret },
        cache: 'no-store',
        signal,
    });
    if (!registration.ok) return registration;
    return send();
}
