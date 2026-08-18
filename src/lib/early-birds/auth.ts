import { headers as requestHeaders } from 'next/headers';
import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { getCookies } from 'better-auth/cookies';
import { magicLink } from 'better-auth/plugins';

import { prisma } from '@/lib/db';
import {
    LISTENER_SESSION_COOKIE,
    listenerSessionAuthHandler,
    listenerSessionCookieNames,
    type ListenerSessionCookieNames,
} from '@/lib/listener/session-cookie-bridge';
import {
    listenerRuntimeBundle,
    listenerAppleOAuthConfiguration,
    listenerRuntimeFlag,
    listenerRuntimeTrustedOrigins,
    listenerRuntimeValue,
} from '@/lib/listener/runtime-env';
import {
    deliverEarlyBirdMagicLink,
    EARLY_BIRD_MAGIC_LINK_TTL_SECONDS,
    earlyBirdMagicLinkAvailable,
    earlyBirdMagicLinkSessionAllowed,
    hashEarlyBirdMagicLinkToken,
} from '@/lib/early-birds/magic-link';
import { currentListenerAccountSession } from '@/lib/listener/account-rp';

export const EARLY_BIRD_AUTH_BASE_PATH = '/api/early-birds/auth';
export const EARLY_BIRD_COOKIE_PREFIX = 'hb_earlybird';
export const EARLY_BIRD_SESSION_COOKIE = 'hb_earlybird_session';
export { LISTENER_SESSION_COOKIE };

export function earlyBirdTestAuthEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    return earlyBirdTestLoginSecret(environment) !== null;
}

export function earlyBirdTestLoginSecret(
    environment: NodeJS.ProcessEnv = process.env,
): string | null {
    try {
        const configuration = listenerRuntimeBundle(
            ['TEST_ACCESS_ENABLED', 'TEST_LOGIN_SECRET'],
            environment,
        );
        return configuration && listenerRuntimeFlag('TEST_ACCESS_ENABLED', environment) &&
            configuration.TEST_LOGIN_SECRET.length >= 32
            ? configuration.TEST_LOGIN_SECRET
            : null;
    } catch {
        return null;
    }
}

export function earlyBirdOAuthAvailability(environment: NodeJS.ProcessEnv = process.env) {
    let google = null;
    let apple = null;
    try {
        google = listenerRuntimeBundle(
            ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
            environment,
        );
    } catch { /* An invalid pair is unavailable. */ }
    try {
        apple = listenerAppleOAuthConfiguration(environment);
    } catch { /* An invalid pair is unavailable. */ }
    return {
        google: google !== null,
        apple: apple !== null,
    } as const;
}

export function earlyBirdSocialProviders(environment: NodeJS.ProcessEnv = process.env) {
    let google = null;
    let apple = null;
    try {
        google = listenerRuntimeBundle(
            ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
            environment,
        );
    } catch { /* Do not expose a provider with mixed credentials. */ }
    try {
        apple = listenerAppleOAuthConfiguration(environment);
    } catch { /* Do not expose a provider with mixed credentials. */ }
    return {
        ...(google ? {
            google: {
                clientId: google.GOOGLE_CLIENT_ID,
                clientSecret: google.GOOGLE_CLIENT_SECRET,
                accessType: 'online' as const,
                // Listener is commonly used on shared staff/test browsers. Do not
                // let Google silently reuse the last account and strand the user
                // behind an account_not_linked error with no way to switch.
                prompt: 'select_account' as const,
            },
        } : {}),
        ...(apple ? {
            apple: {
                clientId: apple.clientId,
                clientSecret: apple.clientSecret,
                mapProfileToUser: listenerAppleProfileToUser,
            },
        } : {}),
    };
}

type ListenerAppleProfile = {
    sub: string;
    email?: string | null;
    email_verified?: boolean | string;
    name?: string | null;
};

/**
 * Apple may return name only on first consent and can omit email later. The
 * provider subject remains authoritative; this non-deliverable, one-way
 * fallback only satisfies the local user schema and never links providers.
 */
export function listenerAppleProfileToUser(profile: ListenerAppleProfile) {
    if (!profile.sub) throw new Error('Apple profile subject unavailable');
    const suppliedEmail = profile.email?.trim();
    const opaqueSubject = createHash('sha256')
        .update(`listener-apple:${profile.sub}`)
        .digest('base64url');
    return {
        name: profile.name?.trim() || 'Listener',
        email: suppliedEmail || `apple-${opaqueSubject}@identity.invalid`,
        emailVerified: Boolean(suppliedEmail) &&
            (profile.email_verified === true || profile.email_verified === 'true'),
    };
}

function authSecret(): string {
    const configured = listenerRuntimeValue('AUTH_SECRET');
    if (configured) return configured;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('BEACON_LISTENER_AUTH_SECRET or its legacy alias is required at runtime');
    }

    // Local/test fallback only. Production never reaches this value.
    return 'early-birds-local-only-secret-change-before-deploy';
}

export function earlyBirdTrustedOrigins(
    environment: NodeJS.ProcessEnv = process.env,
): string[] {
    return listenerRuntimeTrustedOrigins(environment);
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

function scrubSessionMetadata<T extends Record<string, unknown>>(session: T): T {
    return {
        ...session,
        ipAddress: null,
        userAgent: null,
    };
}

function buildEarlyBirdAuth() {
    const testAuth = earlyBirdTestAuthEnabled();
    const baseURL = listenerRuntimeValue('AUTH_BASE_URL');
    const magicLinkEnabled = earlyBirdMagicLinkAvailable();

    return betterAuth({
        appName: 'Harmonic Beacon Listener',
        ...(baseURL ? { baseURL } : {}),
        basePath: EARLY_BIRD_AUTH_BASE_PATH,
        secret: authSecret(),
        trustedOrigins: earlyBirdTrustedOrigins(),
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        socialProviders: earlyBirdSocialProviders(),
        plugins: magicLinkEnabled ? [magicLink({
            expiresIn: EARLY_BIRD_MAGIC_LINK_TTL_SECONDS,
            storeToken: {
                type: 'custom-hasher',
                hash: async (token) => hashEarlyBirdMagicLinkToken(token),
            },
            rateLimit: { window: 60, max: 3 },
            async sendMagicLink(data, context) {
                await deliverEarlyBirdMagicLink(data, context?.request);
            },
        })] : [],
        // Email/password is a supervised synthetic-login seam only. Public
        // passwordless email is a separate one-use plugin, and this seam is absent
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
            session: {
                create: {
                    async before(session, context) {
                        if (!await earlyBirdMagicLinkSessionAllowed(
                            session.userId,
                            context?.path,
                        )) return false;
                        return { data: scrubSessionMetadata(session) };
                    },
                },
                update: {
                    async before(session) {
                        return { data: scrubSessionMetadata(session) };
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

/**
 * The session cookie pair as Better Auth actually resolved it, including its
 * `__Secure-` convention, plus the canonical Listener mirror name and the
 * resolved cookie scope. Passing the resolved attributes through keeps every
 * bridge-side expiry on exactly the scope Better Auth minted into; Better
 * Auth never resolves a Domain here, and the bridge never invents one.
 */
export function earlyBirdSessionCookieNames(): ListenerSessionCookieNames {
    const sessionToken = getCookies(earlyBirdAuth().options).sessionToken;
    return listenerSessionCookieNames(sessionToken.name, {
        path: sessionToken.attributes.path,
        httpOnly: sessionToken.attributes.httpOnly,
        // Better Auth resolves lowercase; emit the canonical wire casing.
        sameSite: sessionToken.attributes.sameSite.charAt(0).toUpperCase() +
            sessionToken.attributes.sameSite.slice(1),
        secure: sessionToken.attributes.secure,
    });
}

/**
 * Shared Better Auth route handler with the Listener session-cookie bridge:
 * invalid inbound session-cookie states are rejected generically before
 * Better Auth runs, and every emitted session cookie (sign-in, rotation,
 * sign-out) is mirrored on the way out. Better Auth's own base path, cookie
 * and verification are unchanged.
 */
export function earlyBirdAuthHandler(request: Request): Promise<Response> {
    return listenerSessionAuthHandler(
        (bridged) => earlyBirdAuth().handler(bridged),
        earlyBirdSessionCookieNames(),
    )(request);
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
    return currentListenerAccountSession(resolvedHeaders);
}
