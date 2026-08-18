import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { headers as requestHeaders } from 'next/headers';

import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';

import { prisma } from '@/lib/db';
import {
    ACCOUNT_AUTH_BASE_PATH,
    ACCOUNT_COOKIE_PREFIX,
    ACCOUNT_EMAIL_TTL_SECONDS,
    ACCOUNT_SESSION_COOKIE,
    activeAccountStaticClients,
    accountOrigin,
    accountEnvironment,
    accountSecret,
    accountSocialProviderConfiguration,
    accountTokenPrefixes,
    accountTrustedOrigins,
    isCurrentAccountHost,
} from '@/lib/account/config';
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
} from '@/lib/account/password-policy';
import { hashAccountPassword, verifyAccountPassword } from '@/lib/session-auth';
import { normalizeBeaconDisplayName } from '@/lib/account/profile';

function normalizedDisplayName(value: unknown): string {
    return normalizeBeaconDisplayName(value) ?? 'Beacon Listener';
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

type AppleProfile = {
    sub: string;
    email?: string | null;
    email_verified?: boolean | string;
    name?: string | null;
};

export function accountAppleProfileToUser(profile: AppleProfile) {
    if (!profile.sub) throw new Error('Apple profile subject unavailable');
    const email = profile.email?.trim().toLowerCase();
    const subjectDigest = createHash('sha256')
        .update(`beacon-account-apple:${profile.sub}`).digest('base64url');
    return {
        name: normalizedDisplayName(profile.name),
        email: email || `apple-${subjectDigest}@identity.invalid`,
        emailVerified: Boolean(email) &&
            (profile.email_verified === true || profile.email_verified === 'true'),
    };
}

function socialProviders() {
    const providers = accountSocialProviderConfiguration();
    return {
        ...(providers.google ? {
            google: {
                ...providers.google,
                accessType: 'online' as const,
                prompt: 'select_account' as const,
            },
        } : {}),
        ...(providers.apple ? {
            apple: {
                ...providers.apple,
                mapProfileToUser: accountAppleProfileToUser,
            },
        } : {}),
    };
}

function buildAccountAuth() {
    const baseURL = accountOrigin();
    return betterAuth({
        appName: 'Harmonic Beacon Account',
        baseURL,
        basePath: ACCOUNT_AUTH_BASE_PATH,
        secret: accountSecret(),
        trustedOrigins: accountTrustedOrigins(),
        database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
        socialProviders: socialProviders(),
        emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
            minPasswordLength: ACCOUNT_PASSWORD_MIN_LENGTH,
            maxPasswordLength: ACCOUNT_PASSWORD_MAX_LENGTH,
            autoSignIn: false,
            revokeSessionsOnPasswordReset: true,
            password: { hash: hashAccountPassword, verify: verifyAccountPassword },
        },
        emailVerification: {
            expiresIn: ACCOUNT_EMAIL_TTL_SECONDS,
            // Credential identity + durable delivery intent commit together
            // via the database trigger. Delivery is processed post-commit.
            sendOnSignUp: false,
            sendOnSignIn: false,
            autoSignInAfterVerification: false,
        },
        user: {
            modelName: 'earlyBirdUser',
            additionalFields: {
                securityRevision: {
                    type: 'number', required: false, defaultValue: 1, input: false,
                },
            },
            changeEmail: { enabled: false },
            deleteUser: { enabled: false },
        },
        session: {
            modelName: 'earlyBirdAuthSession',
            expiresIn: 60 * 60 * 24 * 30,
            updateAge: 60 * 60 * 24,
            cookieCache: { enabled: false },
            additionalFields: {
                securityRevision: {
                    type: 'number', required: false, defaultValue: 1, input: false,
                },
                authorityEnvironment: {
                    type: 'string', required: false, defaultValue: 'legacy', input: false,
                },
            },
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
        verification: { modelName: 'earlyBirdVerification', storeIdentifier: 'hashed' },
        databaseHooks: {
            user: {
                create: {
                    async before(user) {
                        return { data: { ...user, name: normalizedDisplayName(user.name) } };
                    },
                },
            },
            account: {
                create: { async before(account) { return { data: scrubOAuthTokens(account) }; } },
                update: { async before(account) { return { data: scrubOAuthTokens(account) }; } },
            },
            session: {
                create: {
                    async before(session) {
                        const user = await prisma.earlyBirdUser.findUnique({
                            where: { id: session.userId }, select: { securityRevision: true },
                        });
                        if (!user) return false;
                        return {
                            data: {
                                ...session,
                                ipAddress: null,
                                userAgent: null,
                                securityRevision: user.securityRevision,
                                authorityEnvironment: accountEnvironment(),
                            },
                        };
                    },
                },
                update: {
                    async before(session) {
                        return { data: { ...session, ipAddress: null, userAgent: null } };
                    },
                },
            },
        },
        plugins: [
            jwt({
                schema: { jwks: { modelName: 'beaconJwks' } },
                jwks: {
                    jwksPath: '/.well-known/jwks.json',
                    keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
                    rotationInterval: 60 * 60 * 24 * 90,
                    gracePeriod: 60 * 60 * 24 * 30,
                },
                jwt: { issuer: baseURL, expirationTime: '15m' },
            }),
            oauthProvider({
                loginPage: '/account',
                consentPage: '/account/consent',
                scopes: ['openid', 'profile'],
                grantTypes: ['authorization_code'],
                codeExpiresIn: 5 * 60,
                accessTokenExpiresIn: 15 * 60,
                idTokenExpiresIn: 15 * 60,
                allowDynamicClientRegistration: false,
                allowUnauthenticatedClientRegistration: false,
                cachedTrustedClients: new Set(activeAccountStaticClients().map(({ clientId }) => clientId)),
                prefix: accountTokenPrefixes(),
                advertisedMetadata: {
                    scopes_supported: ['openid', 'profile'],
                    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'sid'],
                },
                customIdTokenClaims: async () => ({
                    name: undefined,
                    picture: undefined,
                    given_name: undefined,
                    family_name: undefined,
                    auth_time: undefined,
                    acr: undefined,
                }),
                customUserInfoClaims: async ({ user }) => {
                    const profile = await prisma.beaconProfile.findUnique({
                        where: { accountId: user.id }, select: { displayName: true, revision: true },
                    });
                    return {
                        name: profile?.displayName ?? 'Beacon Listener',
                        profile_revision: profile?.revision ?? 1,
                        picture: undefined,
                        given_name: undefined,
                        family_name: undefined,
                    };
                },
                schema: {
                    oauthClient: { modelName: 'beaconOAuthClient' },
                    oauthRefreshToken: { modelName: 'beaconOAuthRefreshToken' },
                    oauthAccessToken: { modelName: 'beaconOAuthAccessToken' },
                    oauthConsent: { modelName: 'beaconOAuthConsent' },
                },
            }),
        ],
        disabledPaths: [
            '/token',
            '/verify-email',
            '/send-verification-email',
            '/request-password-reset',
            '/reset-password',
            '/change-email',
            '/change-password',
            '/set-password',
            '/link-social',
            '/unlink-account',
        ],
        rateLimit: { enabled: true, window: 60, max: 20, storage: 'memory' },
        advanced: {
            cookiePrefix: ACCOUNT_COOKIE_PREFIX,
            cookies: { session_token: { name: ACCOUNT_SESSION_COOKIE } },
            // Better Auth prepends `__Secure-` when this flag is true, even to
            // an explicit `__Host-` custom name. Attributes below provide the
            // HTTPS guarantees without producing an invalid double prefix.
            useSecureCookies: false,
            defaultCookieAttributes: {
                httpOnly: true,
                secure: baseURL.startsWith('https://'),
                sameSite: 'lax',
                path: '/',
            },
        },
    });
}

let singleton: ReturnType<typeof buildAccountAuth> | undefined;

export function accountAuth() {
    singleton ??= buildAccountAuth();
    return singleton;
}

export type CurrentAccountSession = {
    user: {
        id: string;
        email: string | null;
        emailVerified: boolean;
        accessMethod: 'email' | 'google' | 'apple';
    };
    session: { id: string; expiresAt: Date };
    profile: { accountId: string; displayName: string; revision: number };
};

function accountSessionToken(headers: Headers): string | null {
    const cookieHeader = headers.get('cookie') ?? '';
    if (cookieHeader.length > 8192) return null;
    const values = cookieHeader.split(';').flatMap((part) => {
        const [name, ...raw] = part.trim().split('=');
        return name === ACCOUNT_SESSION_COOKIE ? [raw.join('=')] : [];
    });
    if (values.length !== 1 || values[0].length > 1024) return null;
    let signed: string;
    try { signed = decodeURIComponent(values[0]); } catch { return null; }
    const separator = signed.lastIndexOf('.');
    if (separator < 1) return null;
    const token = signed.slice(0, separator);
    const signature = signed.slice(separator + 1);
    if (!token || token.length > 512 || signature.length !== 44 || !signature.endsWith('=')) {
        return null;
    }
    const expected = createHmac('sha256', accountSecret()).update(token).digest('base64');
    const presentedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    return presentedBytes.length === expectedBytes.length &&
        timingSafeEqual(presentedBytes, expectedBytes) ? token : null;
}

/**
 * Boolean-only, read-only navigation hint from the Account host's durable
 * session. Unlike Better Auth getSession this never refreshes or deletes a
 * session while rendering a decorative global control.
 */
export async function locallyKnownAccountSession(
    headers: Headers,
    now = new Date(),
): Promise<boolean> {
    if (!isCurrentAccountHost(headers.get('host'))) return false;
    const token = accountSessionToken(headers);
    if (!token) return false;
    const session = await prisma.earlyBirdAuthSession.findUnique({
        where: { token },
        select: {
            expiresAt: true,
            securityRevision: true,
            authorityEnvironment: true,
            user: { select: { securityRevision: true } },
        },
    });
    return Boolean(session && session.expiresAt > now &&
        session.securityRevision === session.user.securityRevision &&
        session.authorityEnvironment === accountEnvironment());
}

export async function currentAccountSession(headers?: Headers): Promise<CurrentAccountSession | null> {
    const incoming = headers ?? new Headers(await requestHeaders());
    const result = await accountAuth().api.getSession({ headers: incoming });
    if (!result) return null;
    const authority = await prisma.earlyBirdAuthSession.findUnique({
        where: { id: result.session.id },
        select: {
            securityRevision: true,
            authorityEnvironment: true,
            user: {
                select: {
                    securityRevision: true,
                    beaconProfile: { select: { displayName: true, revision: true } },
                    identities: { select: { providerId: true }, take: 2 },
                },
            },
        },
    });
    if (!authority || authority.securityRevision !== authority.user.securityRevision ||
        authority.authorityEnvironment !== accountEnvironment()) return null;
    const providers = [...new Set(authority.user.identities.map(({ providerId }) => providerId))];
    if (providers.length !== 1 || !['credential', 'google', 'apple'].includes(providers[0])) return null;
    const accessMethod = providers[0] === 'credential' ? 'email' : providers[0] as 'google' | 'apple';
    const deliverableEmail = result.user.email.endsWith('@identity.invalid') ? null : result.user.email;
    return {
        user: {
            id: result.user.id,
            email: deliverableEmail,
            emailVerified: result.user.emailVerified,
            accessMethod,
        },
        session: { id: result.session.id, expiresAt: result.session.expiresAt },
        profile: {
            accountId: result.user.id,
            displayName: authority.user.beaconProfile?.displayName ?? 'Beacon Listener',
            revision: authority.user.beaconProfile?.revision ?? 1,
        },
    };
}
