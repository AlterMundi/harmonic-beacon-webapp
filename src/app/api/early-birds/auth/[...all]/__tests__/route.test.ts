import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth', () => ({ earlyBirdAuthHandler: handler }));

import { GET, POST } from '../route';

describe('EarlyBird public auth route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.example.test');
        vi.stubEnv('EARLY_BIRDS_TRUSTED_ORIGINS', 'https://listen.example.test,https://earlybirds-staging.example.test');
        vi.stubEnv(
            'EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL',
            'http://pmp-myth-mail:8765/api/internal/v1/listener-magic-links/deliver',
        );
        vi.stubEnv('EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN', 'delivery-token-with-at-least-32-characters');
        vi.stubEnv('EARLY_BIRDS_MAGIC_LINK_RATE_SECRET', 'rate-secret-with-at-least-32-characters-long');
        handler.mockResolvedValue(new Response(null, { status: 204 }));
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(['sign-up', 'sign-in'])('does not publicly expose synthetic email %s', async (operation) => {
        const request = new NextRequest(
            `https://earlybirds-staging.example.test/api/early-birds/auth/${operation}/email`,
            { method: 'POST', body: '{}' },
        );
        const response = await POST(request);
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(handler).not.toHaveBeenCalled();
    });

    it.each([null, 'https://attacker.invalid'])('rejects an untrusted mutation origin: %s', async (origin) => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/social',
            {
                method: 'POST',
                headers: origin ? { origin } : {},
                body: '{}',
            },
        );
        const response = await POST(request);
        expect(response.status).toBe(403);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(handler).not.toHaveBeenCalled();
    });

    it('allows an exact trusted Listener origin', async () => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/social',
            { method: 'POST', headers: { origin: 'https://listen.example.test' }, body: '{}' },
        );
        expect((await POST(request)).status).toBe(204);
        expect(handler).toHaveBeenCalledOnce();
    });

    it('accepts canonical Listener origin config and rejects conflicting aliases', async () => {
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', '');
        vi.stubEnv('EARLY_BIRDS_TRUSTED_ORIGINS', '');
        vi.stubEnv('BEACON_LISTENER_AUTH_BASE_URL', 'https://listen.example.test');
        vi.stubEnv('BEACON_LISTENER_TRUSTED_ORIGINS', 'https://listen.example.test');
        const request = () => new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/social',
            { method: 'POST', headers: { origin: 'https://listen.example.test' }, body: '{}' },
        );
        expect((await POST(request())).status).toBe(204);

        handler.mockClear();
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', 'https://other.example.test');
        expect((await POST(request())).status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('lets the provider callback reach its one-time state verifier', async () => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/callback/apple',
            { method: 'POST', headers: { origin: 'https://appleid.apple.com' }, body: '{}' },
        );
        expect((await POST(request)).status).toBe(204);
        expect(handler).toHaveBeenCalledOnce();
    });

    it.each([
        ['/listener', '/listener?authError=1'],
        ['/listener/redeem', '/listener?authError=1'],
        ['/early-birds', '/early-birds?authError=1'],
        ['/early-birds/redeem', '/early-birds?authError=1'],
    ])('accepts exact Listener callback %s with constrained locale metadata', async (callbackURL, errorCallbackURL) => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/magic-link',
            {
                method: 'POST',
                headers: {
                    origin: 'https://listen.example.test',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    email: 'listener@example.test',
                    callbackURL,
                    errorCallbackURL,
                    metadata: { locale: 'es' },
                }),
            },
        );

        expect((await POST(request)).status).toBe(204);
        expect(handler).toHaveBeenCalledOnce();
    });

    it.each([
        {},
        { callbackURL: 'https://attacker.invalid/collect' },
        { callbackURL: '/ops' },
        { callbackURL: '/listener-other' },
        { callbackURL: '/listener/redeem/extra' },
        { callbackURL: '/listener', errorCallbackURL: '/listener?authError=2' },
        { callbackURL: '/early-birds', metadata: { locale: 'en', token: 'leak' } },
    ])('rejects unsafe magic-link request fields: %j', async (body) => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/magic-link',
            {
                method: 'POST',
                headers: {
                    origin: 'https://listen.example.test',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ email: 'listener@example.test', ...body }),
            },
        );

        expect((await POST(request)).status).toBe(400);
        expect(handler).not.toHaveBeenCalled();
    });

    it('hides both magic-link endpoints when delivery is not fully configured', async () => {
        vi.stubEnv('EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN', 'short');
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/sign-in/magic-link',
            {
                method: 'POST',
                headers: {
                    origin: 'https://listen.example.test',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ email: 'listener@example.test', callbackURL: '/early-birds' }),
            },
        );

        expect((await POST(request)).status).toBe(404);
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects an off-surface callback before a token can mint a session', async () => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/magic-link/verify?token=opaque&callbackURL=%2Fops',
        );

        expect((await GET(request)).status).toBe(400);
        expect(handler).not.toHaveBeenCalled();
    });
});
