// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clearListenerOAuthAttempt,
    consumeListenerOAuthAttempt,
    LISTENER_OAUTH_RECOVERY_MARKER,
    markListenerOAuthAttempt,
    recoverListenerIdentity,
} from '../auth-client';

describe('Listener OAuth recovery marker', () => {
    beforeEach(() => sessionStorage.clear());
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('stores only a bounded opaque nonce and timestamp', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
        markListenerOAuthAttempt(1_800_000_000_000);
        const raw = sessionStorage.getItem(LISTENER_OAUTH_RECOVERY_MARKER);
        expect(raw).toBe(JSON.stringify({
            nonce: '123e4567-e89b-12d3-a456-426614174000',
            startedAt: 1_800_000_000_000,
        }));
        expect(raw).not.toMatch(/apple|google|email|provider/i);
        clearListenerOAuthAttempt();
        expect(sessionStorage.getItem(LISTENER_OAUTH_RECOVERY_MARKER)).toBeNull();
    });

    it('accepts a fresh local marker once and consumes it', () => {
        sessionStorage.setItem(LISTENER_OAUTH_RECOVERY_MARKER, JSON.stringify({
            nonce: '123e4567-e89b-12d3-a456-426614174000',
            startedAt: 1_800_000_000_000,
        }));
        expect(consumeListenerOAuthAttempt(1_800_000_010_000)).toBe(true);
        expect(consumeListenerOAuthAttempt(1_800_000_010_000)).toBe(false);
    });

    it.each([
        'malformed',
        JSON.stringify({ nonce: 'provider-google', startedAt: 1_800_000_000_000 }),
        JSON.stringify({ nonce: '123e4567-e89b-12d3-a456-426614174000', startedAt: 1_799_000_000_000 }),
    ])('rejects and consumes invalid or stale markers', (marker) => {
        sessionStorage.setItem(LISTENER_OAUTH_RECOVERY_MARKER, marker);
        expect(consumeListenerOAuthAttempt(1_800_000_010_000)).toBe(false);
        expect(sessionStorage.getItem(LISTENER_OAUTH_RECOVERY_MARKER)).toBeNull();
    });

    it('calls only the exact same-origin recovery endpoint', async () => {
        document.documentElement.lang = 'en';
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            url: 'https://account.harmonicbeacon.com/account/logout?mode=current',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(recoverListenerIdentity()).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('/api/listener/auth/recover', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'current', locale: 'en' }),
        });
    });

    it('rejects a recovery response that points outside the exact Account logout surface', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            url: 'https://evil.example/account/logout',
        })));
        await expect(recoverListenerIdentity()).resolves.toBe(false);
    });
});
