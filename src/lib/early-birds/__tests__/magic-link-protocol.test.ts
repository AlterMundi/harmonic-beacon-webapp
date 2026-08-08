import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth/minimal';
import { magicLink } from 'better-auth/plugins';

import {
    EARLY_BIRD_MAGIC_LINK_TTL_SECONDS,
    hashEarlyBirdMagicLinkToken,
} from '../magic-link';

type MemoryRow = Record<string, unknown>;

function protocol(expiresIn = EARLY_BIRD_MAGIC_LINK_TTL_SECONDS) {
    const database: Record<string, MemoryRow[]> = {
        user: [],
        session: [],
        account: [],
        verification: [],
    };
    let deliveredURL = '';
    const auth = betterAuth({
        baseURL: 'https://listen.example.test',
        secret: 'test-auth-secret-with-at-least-32-characters',
        trustedOrigins: ['https://listen.example.test'],
        database: memoryAdapter(database),
        rateLimit: { enabled: false },
        plugins: [magicLink({
            expiresIn,
            storeToken: {
                type: 'custom-hasher',
                hash: async (token) => hashEarlyBirdMagicLinkToken(token),
            },
            async sendMagicLink({ url }) {
                deliveredURL = url;
            },
        })],
    });
    return {
        auth,
        database,
        deliveredURL: () => deliveredURL,
    };
}

async function requestLink(
    auth: { handler(request: Request): Promise<Response> },
    email = 'new@example.test',
) {
    return auth.handler(new Request('https://listen.example.test/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: {
            origin: 'https://listen.example.test',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ email, callbackURL: '/early-birds' }),
    }));
}

afterEach(() => {
    vi.useRealTimers();
});

describe('pinned Better Auth magic-link protocol', () => {
    it('stores only a verifier and consumes a valid token into one session', async () => {
        const state = protocol();
        expect((await requestLink(state.auth)).status).toBe(200);
        const deliveredURL = state.deliveredURL();
        const token = new URL(deliveredURL).searchParams.get('token')!;

        expect(state.database.verification).toHaveLength(1);
        expect(state.database.verification[0].identifier).toBe(hashEarlyBirdMagicLinkToken(token));
        expect(JSON.stringify(state.database.verification)).not.toContain(token);

        const response = await state.auth.handler(new Request(deliveredURL));
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://listen.example.test/early-birds');
        expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
        expect(state.database.user).toHaveLength(1);
        expect(state.database.session).toHaveLength(1);
        expect(state.database.verification).toHaveLength(0);
    });

    it('rejects replay and altered tokens without minting another session', async () => {
        const state = protocol();
        await requestLink(state.auth);
        const deliveredURL = state.deliveredURL();
        await state.auth.handler(new Request(deliveredURL));
        const sessionsAfterFirstUse = state.database.session.length;

        const replay = await state.auth.handler(new Request(deliveredURL));
        expect(replay.status).toBe(302);
        expect(replay.headers.get('location')).toContain('error=INVALID_TOKEN');
        expect(state.database.session).toHaveLength(sessionsAfterFirstUse);

        const altered = new URL(deliveredURL);
        altered.searchParams.set('token', `${altered.searchParams.get('token')}altered`);
        const alteredResponse = await state.auth.handler(new Request(altered));
        expect(alteredResponse.status).toBe(302);
        expect(alteredResponse.headers.get('location')).toContain('error=INVALID_TOKEN');
        expect(state.database.session).toHaveLength(sessionsAfterFirstUse);
    });

    it('rejects an expired token without creating a user or session', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-07T10:00:00.000Z'));
        const state = protocol(1);
        await requestLink(state.auth);
        const deliveredURL = state.deliveredURL();
        vi.setSystemTime(new Date('2026-08-07T10:00:02.000Z'));

        const expired = await state.auth.handler(new Request(deliveredURL));
        expect(expired.status).toBe(302);
        expect(expired.headers.get('location')).toContain('error=INVALID_TOKEN');
        expect(state.database.user).toHaveLength(0);
        expect(state.database.session).toHaveLength(0);
    });
});
