'use client';

import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

import { EARLY_BIRD_AUTH_BASE_PATH } from './auth-contract';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export const earlyBirdAuthClient = createAuthClient({
    basePath: EARLY_BIRD_AUTH_BASE_PATH,
    plugins: [magicLinkClient()],
});

export const LISTENER_OAUTH_RECOVERY_MARKER = 'hb.listener.oauth-attempt.v1';
const OAUTH_ATTEMPT_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_ATTEMPT_CLOCK_SKEW_MS = 60 * 1000;

/** Record only an opaque, short-lived fact that this tab initiated OAuth. */
export function markListenerOAuthAttempt(now = Date.now()): void {
    try {
        const nonce = crypto.randomUUID();
        sessionStorage.setItem(
            LISTENER_OAUTH_RECOVERY_MARKER,
            JSON.stringify({ nonce, startedAt: now }),
        );
    } catch {
        // Storage availability must never prevent an explicit sign-in.
    }
}

export function clearListenerOAuthAttempt(): void {
    try {
        sessionStorage.removeItem(LISTENER_OAUTH_RECOVERY_MARKER);
    } catch { /* Nothing can be recovered from unavailable tab storage. */ }
}

/**
 * Consume before validating so malformed/stale markers cannot loop. A query
 * string alone can never trigger automatic logout/recovery.
 */
export function consumeListenerOAuthAttempt(now = Date.now()): boolean {
    let raw: string | null;
    try {
        raw = sessionStorage.getItem(LISTENER_OAUTH_RECOVERY_MARKER);
        sessionStorage.removeItem(LISTENER_OAUTH_RECOVERY_MARKER);
    } catch {
        return false;
    }
    if (!raw || raw.length > 256) return false;
    try {
        const marker = JSON.parse(raw) as Record<string, unknown>;
        return typeof marker.nonce === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                .test(marker.nonce) &&
            typeof marker.startedAt === 'number' &&
            Number.isSafeInteger(marker.startedAt) &&
            marker.startedAt <= now + OAUTH_ATTEMPT_CLOCK_SKEW_MS &&
            marker.startedAt >= now - OAUTH_ATTEMPT_MAX_AGE_MS;
    } catch {
        return false;
    }
}

/** Revoke the current Listener session and discard only failed OAuth state. */
export async function recoverListenerIdentity(): Promise<boolean> {
    try {
        const response = await fetch(LISTENER_NAMESPACE.canonical.api.authRecovery, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        return response.ok;
    } catch {
        return false;
    }
}
