import { createHash, randomBytes } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';

import { prisma } from '@/lib/db';
import {
    issueSessionToken,
    sessionCookieOptions,
    sessionCookieTtlSeconds,
} from '@/lib/session-auth';

export const ACCOUNT_STATE_COOKIE = '__Host-hb_account_state';
export const ACCOUNT_LOGIN_TTL_SECONDS = 10 * 60;
export const ACCOUNT_REVALIDATION_SECONDS = 15 * 60;

const LOCAL_RETURN = /^\/(?:$|session(?:\/[A-Za-z0-9_-]+)*$|ops(?:\/[A-Za-z0-9_-]+)*$|staff\/login$)/;
const OPAQUE_CLAIM = /^[\x21-\x7e]{1,512}$/;
const OAUTH_CREDENTIAL = /^[\x21-\x7e]{1,16384}$/;

export type AccountFlow = 'attendee' | 'staff';

export type AccountIdentity = {
    issuer: string;
    subject: string;
    sessionId: string;
    displayName: string | null;
    validatedAt: Date;
};

export type PendingAccountInvitation = {
    promoDigest: string;
    displayName: string;
    termsVersion: string;
    termsAcceptedAt: Date;
};

type AccountConfiguration = {
    issuer: string;
    clientId: string;
    clientSecret: string;
};

type Discovery = {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    userinfo_endpoint: string;
    introspection_endpoint: string;
    end_session_endpoint: string;
    code_challenge_methods_supported?: string[];
    token_endpoint_auth_methods_supported?: string[];
};

type TokenResponse = {
    access_token?: unknown;
    id_token?: unknown;
    token_type?: unknown;
};

type Introspection = {
    active?: unknown;
    client_id?: unknown;
    sub?: unknown;
};

let discoveryCache: { issuer: string; expiresAt: number; value: Discovery } | null = null;
const accountStatusChecks = new Map<string, Promise<boolean>>();

export function beaconAccountEnabled(raw = process.env.BEACON_ACCOUNT_ENABLED): boolean {
    return raw === 'true';
}

export function accountIssuerIsCurrent(issuer: string | null | undefined): boolean {
    if (!issuer) return false;
    try {
        return issuer === accountConfiguration().issuer;
    } catch {
        return false;
    }
}

export function accountConfiguration(env: NodeJS.ProcessEnv = process.env): AccountConfiguration {
    const issuer = canonicalIssuer(required(env, 'BEACON_ACCOUNT_ISSUER_URL'));
    const clientId = required(env, 'BEACON_ACCOUNT_CLIENT_ID');
    const clientSecret = required(env, 'BEACON_ACCOUNT_CLIENT_SECRET');
    if (clientSecret.length < 32) {
        throw new Error('BEACON_ACCOUNT_CLIENT_SECRET must contain at least 32 characters');
    }
    const issuerHost = new URL(issuer).hostname;
    const expectedClient = issuerHost === 'account.harmonicbeacon.com'
        ? 'hb-live'
        : issuerHost === 'account-staging.harmonicbeacon.com'
            ? 'hb-live-staging'
            : null;
    if (expectedClient && clientId !== expectedClient) {
        throw new Error(`BEACON_ACCOUNT_CLIENT_ID must be ${expectedClient} for this issuer`);
    }
    return { issuer, clientId, clientSecret };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required when BEACON_ACCOUNT_ENABLED=true`);
    return value;
}

function canonicalIssuer(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && process.env.NODE_ENV !== 'test') {
        throw new Error('BEACON_ACCOUNT_ISSUER_URL must use HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('BEACON_ACCOUNT_ISSUER_URL must not contain credentials, query or fragment');
    }
    return url.href.replace(/\/$/, '');
}

function exactIssuerEndpoint(raw: unknown, issuer: string, name: string): string {
    if (typeof raw !== 'string') throw new Error(`Account discovery is missing ${name}`);
    const endpoint = new URL(raw);
    const issuerUrl = new URL(issuer);
    if (endpoint.protocol !== issuerUrl.protocol || endpoint.origin !== issuerUrl.origin) {
        throw new Error(`Account ${name} must use the exact issuer origin`);
    }
    if (endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error(`Account ${name} is invalid`);
    }
    return endpoint.href;
}

export async function discoverAccountIssuer(
    config = accountConfiguration(),
    now = Date.now(),
): Promise<Discovery> {
    if (discoveryCache?.issuer === config.issuer && discoveryCache.expiresAt > now) {
        return discoveryCache.value;
    }
    const discoveryUrl = new URL('/.well-known/openid-configuration', `${config.issuer}/`);
    const response = await fetch(discoveryUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Beacon Account discovery unavailable');
    const raw = await response.json() as Record<string, unknown>;
    if (raw.issuer !== config.issuer) throw new Error('Beacon Account discovery issuer mismatch');
    if (!Array.isArray(raw.code_challenge_methods_supported) || !raw.code_challenge_methods_supported.includes('S256')) {
        throw new Error('Beacon Account issuer does not advertise mandatory PKCE S256');
    }
    if (
        !Array.isArray(raw.token_endpoint_auth_methods_supported) ||
        !raw.token_endpoint_auth_methods_supported.includes('client_secret_basic')
    ) {
        throw new Error('Beacon Account issuer does not advertise client_secret_basic');
    }
    const value: Discovery = {
        issuer: config.issuer,
        authorization_endpoint: exactIssuerEndpoint(raw.authorization_endpoint, config.issuer, 'authorization_endpoint'),
        token_endpoint: exactIssuerEndpoint(raw.token_endpoint, config.issuer, 'token_endpoint'),
        jwks_uri: exactIssuerEndpoint(raw.jwks_uri, config.issuer, 'jwks_uri'),
        userinfo_endpoint: exactIssuerEndpoint(raw.userinfo_endpoint, config.issuer, 'userinfo_endpoint'),
        introspection_endpoint: exactIssuerEndpoint(raw.introspection_endpoint, config.issuer, 'introspection_endpoint'),
        end_session_endpoint: exactIssuerEndpoint(raw.end_session_endpoint, config.issuer, 'end_session_endpoint'),
        code_challenge_methods_supported: raw.code_challenge_methods_supported as string[],
        token_endpoint_auth_methods_supported: raw.token_endpoint_auth_methods_supported as string[],
    };
    discoveryCache = { issuer: config.issuer, expiresAt: now + 5 * 60_000, value };
    return value;
}

export function safeAccountReturnTo(raw: string | null | undefined, flow: AccountFlow): string {
    const fallback = flow === 'staff' ? '/ops/events' : '/';
    if (!raw || raw.length > 512 || !LOCAL_RETURN.test(raw) || raw.startsWith('//')) return fallback;
    if (flow === 'staff' && !raw.startsWith('/ops') && raw !== '/staff/login') return fallback;
    if (flow === 'attendee' && raw.startsWith('/ops')) return fallback;
    return raw;
}

export function accountCallbackUrl(origin: string): string {
    return new URL('/api/account/callback', trustedLiveOrigin(origin)).href;
}

function configuredLiveOrigin(): string | null {
    const configuredLoginOrigin = process.env.TICKET_LOGIN_URL_PREFIX?.trim();
    if (!configuredLoginOrigin) return null;
    const pinned = new URL(configuredLoginOrigin);
    if (pinned.protocol !== 'https:' || pinned.username || pinned.password) {
        throw new Error('TICKET_LOGIN_URL_PREFIX must be a credential-free HTTPS URL');
    }
    return pinned.origin;
}

export function trustedLiveOrigin(raw: string): string {
    const url = new URL(raw);
    const pinnedOrigin = configuredLiveOrigin();
    const allowedProduction = url.protocol === 'https:' && (
        url.hostname === 'live.harmonicbeacon.com' ||
        url.hostname === 'live-staging.harmonicbeacon.com' ||
        url.origin === pinnedOrigin
    );
    const allowedLocal = process.env.NODE_ENV !== 'production' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if ((!allowedProduction && !allowedLocal) || url.username || url.password) {
        throw new Error('Untrusted Live origin');
    }
    return url.origin;
}

/**
 * Resolve the browser-visible Live origin at the reverse-proxy boundary.
 *
 * NextRequest.nextUrl can retain the loopback upstream URL even though nginx
 * forwarded the exact public Host. Prefer the operator-pinned URL when it is
 * configured; otherwise accept only the ordinary Host header after applying
 * the same strict Live-origin allowlist. X-Forwarded-Host is deliberately not
 * consulted because it is attacker-controlled outside the trusted edge.
 */
export function trustedLiveRequestOrigin(
    request: Pick<Request, 'headers'> & { nextUrl: URL },
): string {
    const pinnedOrigin = configuredLiveOrigin();
    if (pinnedOrigin) return pinnedOrigin;

    const host = request.headers.get('host')?.trim();
    if (!host) throw new Error('Missing Live Host');
    const publicHost = host === 'live.harmonicbeacon.com' || host === 'live-staging.harmonicbeacon.com';
    const protocol = publicHost ? 'https:' : request.nextUrl.protocol;
    return trustedLiveOrigin(`${protocol}//${host}`);
}

function digest(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomOpaque(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
}

function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function accountStateCookie(value: string, maxAge = ACCOUNT_LOGIN_TTL_SECONDS) {
    return {
        name: ACCOUNT_STATE_COOKIE,
        value,
        httpOnly: true as const,
        secure: true as const,
        sameSite: 'lax' as const,
        path: '/' as const,
        maxAge,
    };
}

export function clearedAccountStateCookie() {
    return { ...accountStateCookie('', 0), expires: new Date(0) };
}

export async function startAccountAuthorization(input: {
    flow: AccountFlow;
    returnTo?: string | null;
    origin: string;
    now?: Date;
    pendingInvitation?: PendingAccountInvitation;
}): Promise<{ authorizationUrl: string; stateCookie: ReturnType<typeof accountStateCookie> }> {
    const config = accountConfiguration();
    const discovery = await discoverAccountIssuer(config);
    const state = randomOpaque();
    const verifier = randomOpaque(48);
    const nonce = randomOpaque();
    const now = input.now ?? new Date();
    const returnTo = safeAccountReturnTo(input.returnTo, input.flow);
    await prisma.accountLoginAttempt.create({
        data: {
            stateDigest: digest(state),
            codeVerifier: verifier,
            nonce,
            flow: input.flow,
            returnTo,
            pendingPromoDigest: input.pendingInvitation?.promoDigest,
            pendingDisplayName: input.pendingInvitation?.displayName,
            pendingTermsVersion: input.pendingInvitation?.termsVersion,
            pendingTermsAcceptedAt: input.pendingInvitation?.termsAcceptedAt,
            expiresAt: new Date(now.getTime() + ACCOUNT_LOGIN_TTL_SECONDS * 1000),
        },
    });
    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('redirect_uri', accountCallbackUrl(input.origin));
    authorizationUrl.searchParams.set('scope', 'openid profile');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', pkceChallenge(verifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    return { authorizationUrl: authorizationUrl.href, stateCookie: accountStateCookie(state) };
}

function basicAuth(config: AccountConfiguration): string {
    return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64')}`;
}

function boundedOpaque(value: unknown, label: string): string {
    if (typeof value !== 'string' || !OPAQUE_CLAIM.test(value)) {
        throw new Error(`Beacon Account ${label} claim is invalid`);
    }
    return value;
}

function boundedCredential(value: unknown, label: string): string {
    if (typeof value !== 'string' || !OAUTH_CREDENTIAL.test(value)) {
        throw new Error(`Beacon Account ${label} is invalid`);
    }
    return value;
}

function profileDisplayName(payload: Record<string, unknown>): string | null {
    const raw = typeof payload.name === 'string'
        ? payload.name
        : typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : '';
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
    return name.length > 0 ? name : null;
}

async function exchangeAuthorizationCode(input: {
    code: string;
    verifier: string;
    nonce: string;
    origin: string;
}): Promise<AccountIdentity> {
    const config = accountConfiguration();
    const discovery = await discoverAccountIssuer(config);
    const tokenResponse = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: basicAuth(config),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: accountCallbackUrl(input.origin),
            code_verifier: input.verifier,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error('Beacon Account token exchange failed');
    const tokens = await tokenResponse.json() as TokenResponse;
    const accessToken = boundedCredential(tokens.access_token, 'access token');
    const idToken = boundedCredential(tokens.id_token, 'ID token');
    if (typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') {
        throw new Error('Beacon Account token type is invalid');
    }

    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
        timeoutDuration: 8_000,
        cooldownDuration: 30_000,
    });
    const verified = await jwtVerify(idToken, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
        clockTolerance: 30,
        maxTokenAge: '5 minutes',
        requiredClaims: ['iat', 'exp', 'sub', 'nonce', 'sid'],
    });
    if (verified.payload.nonce !== input.nonce) throw new Error('Beacon Account nonce mismatch');
    const subject = boundedOpaque(verified.payload.sub, 'subject');
    const sessionId = boundedOpaque(verified.payload.sid, 'session id');

    const introspectionResponse = await fetch(discovery.introspection_endpoint, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: basicAuth(config),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
    });
    if (!introspectionResponse.ok) throw new Error('Beacon Account introspection failed');
    const introspection = await introspectionResponse.json() as Introspection;
    if (
        introspection.active !== true ||
        introspection.client_id !== config.clientId ||
        introspection.sub !== subject
    ) {
        throw new Error('Beacon Account access token is not active for this client');
    }

    const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
    });
    if (!userInfoResponse.ok) throw new Error('Beacon Account UserInfo unavailable');
    const userInfo = await userInfoResponse.json() as Record<string, unknown>;
    if (userInfo.sub !== subject) throw new Error('Beacon Account UserInfo subject mismatch');

    return {
        issuer: config.issuer,
        subject,
        sessionId,
        displayName: profileDisplayName(userInfo),
        validatedAt: new Date(),
    };
}

export async function completeAccountAuthorization(input: {
    code: string;
    state: string;
    stateCookie: string | undefined;
    origin: string;
    now?: Date;
}): Promise<{
    identity: AccountIdentity;
    flow: AccountFlow;
    returnTo: string;
    cookie: { name: string; value: string } & ReturnType<typeof sessionCookieOptions>;
    pendingInvitation: PendingAccountInvitation | null;
}> {
    if (!input.stateCookie || input.stateCookie !== input.state || !OPAQUE_CLAIM.test(input.state)) {
        throw new Error('Beacon Account state mismatch');
    }
    const now = input.now ?? new Date();
    const stateDigest = digest(input.state);
    const attempt = await prisma.accountLoginAttempt.findUnique({ where: { stateDigest } });
    if (!attempt || attempt.consumedAt || attempt.expiresAt <= now || !['attendee', 'staff'].includes(attempt.flow)) {
        throw new Error('Beacon Account authorization attempt expired');
    }
    const claimed = await prisma.accountLoginAttempt.updateMany({
        where: { stateDigest, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new Error('Beacon Account authorization attempt was already used');

    const identity = await exchangeAuthorizationCode({
        code: boundedOpaque(input.code, 'authorization code'),
        verifier: attempt.codeVerifier,
        nonce: attempt.nonce,
        origin: input.origin,
    });
    const flow = attempt.flow as AccountFlow;
    const issued = issueSessionToken();
    const staffBinding = flow === 'staff'
        ? await prisma.staffAccountBinding.findUnique({
            where: {
                accountIssuer_accountSubject: {
                    accountIssuer: identity.issuer,
                    accountSubject: identity.subject,
                },
            },
            include: { staffUser: { select: { id: true, disabledAt: true } } },
        })
        : null;
    if (flow === 'staff' && (!staffBinding || staffBinding.disabledAt || staffBinding.staffUser.disabledAt)) {
        throw new Error('Beacon Account is not authorized for staff access');
    }
    await prisma.$transaction(async (tx) => {
        await tx.webSession.updateMany({
            where: {
                accountIssuer: identity.issuer,
                accountSessionId: identity.sessionId,
                revokedAt: null,
            },
            data: { revokedAt: now, revocationReason: 'account_session_replaced' },
        });
        await tx.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                staffUserId: staffBinding?.staffUserId ?? null,
                accountIssuer: identity.issuer,
                accountSubject: identity.subject,
                accountSessionId: identity.sessionId,
                accountDisplayName: identity.displayName,
                accountValidatedAt: identity.validatedAt,
                expiresAt: new Date(now.getTime() + sessionCookieTtlSeconds() * 1000),
                lastSeenAt: now,
            },
        });
        if (staffBinding) {
            await tx.auditLog.create({
                data: {
                    actorUserId: staffBinding.staffUserId,
                    action: 'account.staff.sign_in',
                    targetType: 'STAFF_ACCOUNT_BINDING',
                    targetId: staffBinding.id,
                    metadata: { accountIssuer: identity.issuer },
                },
            });
        }
    });
    return {
        identity,
        flow,
        returnTo: safeAccountReturnTo(attempt.returnTo, flow),
        cookie: {
            name: 'hb_session',
            value: issued.cookieValue,
            ...sessionCookieOptions(now),
        },
        pendingInvitation:
            attempt.pendingPromoDigest &&
            attempt.pendingDisplayName &&
            attempt.pendingTermsVersion &&
            attempt.pendingTermsAcceptedAt
                ? {
                    promoDigest: attempt.pendingPromoDigest,
                    displayName: attempt.pendingDisplayName,
                    termsVersion: attempt.pendingTermsVersion,
                    termsAcceptedAt: attempt.pendingTermsAcceptedAt,
                }
                : null,
    };
}

export function accountIdentityIsFresh(
    identity: Pick<AccountIdentity, 'validatedAt'>,
    now = new Date(),
): boolean {
    const age = now.getTime() - identity.validatedAt.getTime();
    return age >= -30_000 && age <= ACCOUNT_REVALIDATION_SECONDS * 1000;
}

export type AccountSessionCandidate = {
    id: string;
    accountIssuer: string | null;
    accountSubject: string | null;
    accountSessionId: string | null;
    accountDisplayName: string | null;
    accountValidatedAt: Date | null;
};

function identityFromCandidate(row: AccountSessionCandidate): AccountIdentity | null {
    if (
        !accountIssuerIsCurrent(row.accountIssuer) ||
        !row.accountIssuer ||
        !row.accountSubject ||
        !row.accountSessionId ||
        !row.accountValidatedAt ||
        !OPAQUE_CLAIM.test(row.accountSubject) ||
        !OPAQUE_CLAIM.test(row.accountSessionId)
    ) return null;
    return {
        issuer: row.accountIssuer,
        subject: row.accountSubject,
        sessionId: row.accountSessionId,
        displayName: row.accountDisplayName,
        validatedAt: row.accountValidatedAt,
    };
}

export function storedAccountIdentity(row: AccountSessionCandidate): AccountIdentity | null {
    return identityFromCandidate(row);
}

async function fetchAccountSessionStatus(identity: AccountIdentity): Promise<boolean> {
    const config = accountConfiguration();
    if (identity.issuer !== config.issuer) return false;
    const endpoint = new URL('/api/account/session-status', `${config.issuer}/`);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: basicAuth(config),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ sid: identity.sessionId, sub: identity.subject }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok || !response.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
        throw new Error('Beacon Account session status unavailable');
    }
    const status = await response.json() as Record<string, unknown>;
    if (status.active === false) return false;
    if (
        status.active !== true ||
        status.iss !== identity.issuer ||
        status.sub !== identity.subject ||
        status.sid !== identity.sessionId
    ) {
        throw new Error('Beacon Account session status mismatch');
    }
    return true;
}

async function coalescedAccountSessionStatus(identity: AccountIdentity): Promise<boolean> {
    const key = digest(`${identity.issuer}\0${identity.subject}\0${identity.sessionId}`);
    const inFlight = accountStatusChecks.get(key);
    if (inFlight) return inFlight;
    const status = fetchAccountSessionStatus(identity);
    accountStatusChecks.set(key, status);
    try {
        return await status;
    } finally {
        if (accountStatusChecks.get(key) === status) accountStatusChecks.delete(key);
    }
}

/**
 * Return a locally fresh Account identity, revalidating a stale central SID
 * without retaining any provider token. A status outage or mismatch fails
 * closed for this new transition; already-issued media credentials are not
 * recalled by this helper.
 */
export async function validatedAccountIdentity(
    row: AccountSessionCandidate,
    now = new Date(),
): Promise<AccountIdentity | null> {
    const identity = identityFromCandidate(row);
    if (!identity) return null;
    if (accountIdentityIsFresh(identity, now)) return identity;

    let active: boolean;
    try {
        active = await coalescedAccountSessionStatus(identity);
    } catch {
        return null;
    }
    if (!active) {
        await prisma.webSession.updateMany({
            where: {
                accountIssuer: identity.issuer,
                accountSubject: identity.subject,
                accountSessionId: identity.sessionId,
                revokedAt: null,
            },
            data: { revokedAt: now, revocationReason: 'account_session_inactive' },
        });
        return null;
    }

    const refreshed = await prisma.webSession.updateMany({
        where: {
            id: row.id,
            accountIssuer: identity.issuer,
            accountSubject: identity.subject,
            accountSessionId: identity.sessionId,
            accountValidatedAt: identity.validatedAt,
            revokedAt: null,
        },
        data: { accountValidatedAt: now },
    });
    if (refreshed.count === 1) return { ...identity, validatedAt: now };

    // Another request may have refreshed this exact row after sharing the same
    // backchannel check. Re-read it; a concurrent revoke still fails closed.
    const current = await prisma.webSession.findUnique({
        where: { id: row.id },
        select: {
            id: true,
            accountIssuer: true,
            accountSubject: true,
            accountSessionId: true,
            accountDisplayName: true,
            accountValidatedAt: true,
            revokedAt: true,
        },
    });
    if (!current || current.revokedAt) return null;
    const currentIdentity = identityFromCandidate(current);
    return currentIdentity && accountIdentityIsFresh(currentIdentity, now)
        ? currentIdentity
        : null;
}

export async function accountLogoutUrl(origin: string): Promise<string> {
    const config = accountConfiguration();
    const discovery = await discoverAccountIssuer(config);
    const url = new URL(discovery.end_session_endpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('post_logout_redirect_uri', new URL('/', trustedLiveOrigin(origin)).href);
    return url.href;
}

export async function revokeCentralSession(issuer: string, sid: string, now = new Date()): Promise<number> {
    const config = accountConfiguration();
    if (issuer !== config.issuer || !OPAQUE_CLAIM.test(sid)) return 0;
    const result = await prisma.webSession.updateMany({
        where: { accountIssuer: issuer, accountSessionId: sid, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'account_frontchannel_logout' },
    });
    return result.count;
}

export async function revokeAllAccountSessions(
    issuer: string,
    subject: string,
    now = new Date(),
): Promise<number> {
    const config = accountConfiguration();
    if (issuer !== config.issuer || !OPAQUE_CLAIM.test(subject)) return 0;
    const result = await prisma.webSession.updateMany({
        where: { accountIssuer: issuer, accountSubject: subject, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'account_all_devices_logout' },
    });
    return result.count;
}

export function __resetAccountDiscoveryForTests(): void {
    discoveryCache = null;
    accountStatusChecks.clear();
}
