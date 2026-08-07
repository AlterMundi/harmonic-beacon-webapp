import { headers as requestHeaders } from 'next/headers';
import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { prisma } from '@/lib/db';

export const EARLY_BIRD_AUTH_BASE_PATH = '/api/early-birds/auth';
export const EARLY_BIRD_COOKIE_PREFIX = 'hb_earlybird';
export const EARLY_BIRD_SESSION_COOKIE = 'hb_earlybird_session';

function nonEmpty(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

export function earlyBirdTestAuthEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    const secret = nonEmpty(environment.EARLY_BIRDS_TEST_LOGIN_SECRET);
    return (
        environment.EARLY_BIRDS_TEST_ACCESS_ENABLED === '1' &&
        Boolean(secret && secret.length >= 32)
    );
}

export function earlyBirdOAuthAvailability(environment: NodeJS.ProcessEnv = process.env) {
    return {
        google: Boolean(
            nonEmpty(environment.EARLY_BIRDS_GOOGLE_CLIENT_ID) &&
            nonEmpty(environment.EARLY_BIRDS_GOOGLE_CLIENT_SECRET),
        ),
        apple: Boolean(
            nonEmpty(environment.EARLY_BIRDS_APPLE_CLIENT_ID) &&
            nonEmpty(environment.EARLY_BIRDS_APPLE_CLIENT_SECRET),
        ),
    } as const;
}

export function earlyBirdSocialProviders(environment: NodeJS.ProcessEnv = process.env) {
    const googleId = nonEmpty(environment.EARLY_BIRDS_GOOGLE_CLIENT_ID);
    const googleSecret = nonEmpty(environment.EARLY_BIRDS_GOOGLE_CLIENT_SECRET);
    const appleId = nonEmpty(environment.EARLY_BIRDS_APPLE_CLIENT_ID);
    const appleSecret = nonEmpty(environment.EARLY_BIRDS_APPLE_CLIENT_SECRET);
    return {
        ...(googleId && googleSecret ? {
            google: { clientId: googleId, clientSecret: googleSecret, accessType: 'online' as const },
        } : {}),
        ...(appleId && appleSecret ? {
            apple: { clientId: appleId, clientSecret: appleSecret },
        } : {}),
    };
}

function authSecret(): string {
    const configured = nonEmpty(process.env.EARLY_BIRDS_AUTH_SECRET);
    if (configured) return configured;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('EARLY_BIRDS_AUTH_SECRET is required at runtime');
    }

    // Local/test fallback only. Production never reaches this value.
    return 'early-birds-local-only-secret-change-before-deploy';
}

function trustedOrigins(): string[] {
    const configured = (process.env.EARLY_BIRDS_TRUSTED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const baseURL = nonEmpty(process.env.EARLY_BIRDS_AUTH_BASE_URL);
    return baseURL ? [...new Set([baseURL, ...configured])] : configured;
}

function scrubOAuthTokens<T extends Record<string, unknown>>(account: T): T {
    return {
        ...account,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
    };
}

function buildEarlyBirdAuth() {
    const testAuth = earlyBirdTestAuthEnabled();
    const baseURL = nonEmpty(process.env.EARLY_BIRDS_AUTH_BASE_URL);

    return betterAuth({
        appName: 'Harmonic Beacon Listener',
        ...(baseURL ? { baseURL } : {}),
        basePath: EARLY_BIRD_AUTH_BASE_PATH,
        secret: authSecret(),
        trustedOrigins: trustedOrigins(),
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        socialProviders: earlyBirdSocialProviders(),
        // Email/password is a supervised synthetic-login seam only. The public
        // product exposes exactly Google and Apple, and the seam is absent
        // unless both an explicit gate and a separate secret are present.
        emailAndPassword: { enabled: testAuth },
        user: {
            modelName: 'earlyBirdUser',
            changeEmail: { enabled: false },
            deleteUser: { enabled: false },
        },
        session: {
            modelName: 'earlyBirdAuthSession',
            expiresIn: 60 * 60 * 24 * 30,
            updateAge: 60 * 60 * 24,
            cookieCache: { enabled: false },
        },
        account: {
            modelName: 'earlyBirdIdentity',
            updateAccountOnSignIn: false,
            storeStateStrategy: 'database',
            storeAccountCookie: false,
            accountLinking: {
                enabled: false,
                disableImplicitLinking: true,
                trustedProviders: [],
                allowDifferentEmails: false,
                allowUnlinkingAll: false,
                updateUserInfoOnLink: false,
            },
        },
        verification: { modelName: 'earlyBirdVerification' },
        databaseHooks: {
            account: {
                create: {
                    async before(account) {
                        return { data: scrubOAuthTokens(account) };
                    },
                },
                update: {
                    async before(account) {
                        return { data: scrubOAuthTokens(account) };
                    },
                },
            },
        },
        advanced: {
            cookiePrefix: EARLY_BIRD_COOKIE_PREFIX,
            cookies: {
                session_token: { name: EARLY_BIRD_SESSION_COOKIE },
            },
            useSecureCookies: baseURL?.startsWith('https://') ?? process.env.NODE_ENV === 'production',
        },
    });
}

let singleton: ReturnType<typeof buildEarlyBirdAuth> | undefined;

export function earlyBirdAuth() {
    singleton ??= buildEarlyBirdAuth();
    return singleton;
}

export type EarlyBirdSession = {
    user: {
        id: string;
        name: string;
        email: string;
        image?: string | null;
    };
    session: {
        id: string;
        expiresAt: Date;
    };
};

/** Resolve the EarlyBird account authoritatively from its own cookie/table. */
export async function currentEarlyBirdSession(
    suppliedHeaders?: Headers,
): Promise<EarlyBirdSession | null> {
    const resolvedHeaders = suppliedHeaders ?? new Headers(await requestHeaders());
    const result = await earlyBirdAuth().api.getSession({ headers: resolvedHeaders });
    if (!result) return null;

    return {
        user: {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            image: result.user.image,
        },
        session: {
            id: result.session.id,
            expiresAt: result.session.expiresAt,
        },
    };
}
