import { describe, expect, it } from 'vitest';

import {
    EARLY_BIRD_SESSION_COOKIE,
    earlyBirdAuth,
} from '../auth';

describe('EarlyBird Better Auth isolation', () => {
    it('uses only EarlyBird models/cookies and disables every linking path', () => {
        const options = earlyBirdAuth().options;

        expect(options.user?.modelName).toBe('earlyBirdUser');
        expect(options.session?.modelName).toBe('earlyBirdAuthSession');
        expect(options.account?.modelName).toBe('earlyBirdIdentity');
        expect(options.verification?.modelName).toBe('earlyBirdVerification');
        expect(options.advanced?.cookiePrefix).toBe('hb_earlybird');
        expect(options.advanced?.cookies?.session_token?.name).toBe(EARLY_BIRD_SESSION_COOKIE);
        expect(Object.keys(options.socialProviders ?? {}).sort()).toEqual(['apple', 'google']);
        expect(options.account?.accountLinking).toMatchObject({
            enabled: false,
            disableImplicitLinking: true,
            trustedProviders: [],
            allowDifferentEmails: false,
            allowUnlinkingAll: false,
        });
        expect(options.account?.storeAccountCookie).toBe(false);
    });

    it('scrubs provider token material before create and update reach Prisma', async () => {
        const hooks = earlyBirdAuth().options.databaseHooks?.account;
        const providerPayload = {
            id: 'identity-1',
            providerId: 'google',
            accountId: 'google-account',
            userId: 'listener-1',
            accessToken: 'access-secret',
            refreshToken: 'refresh-secret',
            idToken: 'identity-secret',
            accessTokenExpiresAt: new Date('2026-08-07T00:00:00.000Z'),
            refreshTokenExpiresAt: new Date('2026-08-08T00:00:00.000Z'),
            scope: 'openid email profile',
            password: null,
            createdAt: new Date('2026-08-06T00:00:00.000Z'),
            updatedAt: new Date('2026-08-06T00:00:00.000Z'),
        };

        const created = await hooks?.create?.before?.(providerPayload);
        const updated = await hooks?.update?.before?.(providerPayload);

        for (const outcome of [created, updated]) {
            expect(outcome).not.toBe(false);
            expect(outcome && 'data' in outcome ? outcome.data : null).toMatchObject({
                providerId: 'google',
                accountId: 'google-account',
                accessToken: null,
                refreshToken: null,
                idToken: null,
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
                scope: null,
            });
            expect(JSON.stringify(outcome)).not.toContain('access-secret');
            expect(JSON.stringify(outcome)).not.toContain('refresh-secret');
            expect(JSON.stringify(outcome)).not.toContain('identity-secret');
        }
    });
});
