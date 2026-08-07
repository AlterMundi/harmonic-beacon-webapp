import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth', () => ({ earlyBirdAuth: () => ({ handler }) }));

import { POST } from '../route';

describe('EarlyBird public auth route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.example.test');
        vi.stubEnv('EARLY_BIRDS_TRUSTED_ORIGINS', 'https://listen.example.test,https://earlybirds-staging.example.test');
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

    it('lets the provider callback reach its one-time state verifier', async () => {
        const request = new NextRequest(
            'https://listen.example.test/api/early-birds/auth/callback/apple',
            { method: 'POST', headers: { origin: 'https://appleid.apple.com' }, body: '{}' },
        );
        expect((await POST(request)).status).toBe(204);
        expect(handler).toHaveBeenCalledOnce();
    });
});
