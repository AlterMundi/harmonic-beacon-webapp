import {
    createCipheriv, createDecipheriv, createHash, randomBytes,
} from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { prisma } from '@/lib/db';
import { emitAnalyticsEvent } from '@/lib/analytics-server';
import { digestSessionToken } from '@/lib/session-auth';
import { isListenerStagingHost } from '@/lib/listener/public-discovery';

export const LISTENER_ACCOUNT_COOKIE = '__Host-hb_listener_account';
export const LISTENER_ACCOUNT_ATTEMPT_COOKIE = '__Host-hb_listener_account_attempt';
export const LISTENER_ACCOUNT_AUTO_HANDOFF_COOKIE = '__Host-hb_listener_account_auto_handoff';
const MAX_LISTENER_ACCOUNT_COOKIE_LENGTH = 512;

function readSingleBoundedCookie(headers: Headers, name: string, maxLength: number): string | null {
    const prefix = `${name}=`;
    const values = (headers.get('cookie') ?? '').split(';')
        .map((value) => value.trim())
        .filter((value) => value.startsWith(prefix));
    if (values.length !== 1) return null;
    const encoded = values[0].slice(prefix.length);
    if (!encoded || encoded.length > maxLength) return null;
    try {
        const decoded = decodeURIComponent(encoded);
        return decoded.length > 0 && decoded.length <= maxLength ? decoded : null;
    } catch { return null; }
}

/** A valid request contains exactly one bounded, decodable host-only RP cookie. */
export function readListenerAccountCookie(headers: Headers): string | null {
    return readSingleBoundedCookie(headers, LISTENER_ACCOUNT_COOKIE,
        MAX_LISTENER_ACCOUNT_COOKIE_LENGTH);
}

export function readListenerAccountAttemptCookie(headers: Headers): string | null {
    return readSingleBoundedCookie(headers, LISTENER_ACCOUNT_ATTEMPT_COOKIE, 2048);
}

/** A logout/recovery marker suppresses only the optional automatic OIDC hop. */
export function listenerAutomaticHandoffSuppressed(headers: Headers): boolean {
    return readSingleBoundedCookie(headers, LISTENER_ACCOUNT_AUTO_HANDOFF_COOKIE, 8) === '1';
}

type RPConfig = {
    issuer: string; clientId: string; clientSecret: string; redirectUri: string;
    stateSecret: string;
};

function env(name: string): string {
    const value = process.env[name]?.trim();
    if (!value || value.length < 32) throw new Error(`${name} is missing or too short`);
    return value;
}

export function validateListenerAccountRPEnvironment(): boolean {
    const enabled = process.env.BEACON_LISTENER_ACCOUNT_ENABLED?.trim() ?? '0';
    if (enabled !== '0' && enabled !== '1') {
        throw new Error('BEACON_LISTENER_ACCOUNT_ENABLED must be 0 or 1');
    }
    if (enabled === '0') return false;
    const marker = process.env.BEACON_LISTENER_ACCOUNT_ENVIRONMENT?.trim();
    if (marker !== 'production' && marker !== 'staging') {
        throw new Error('BEACON_LISTENER_ACCOUNT_ENVIRONMENT must be production or staging');
    }
    const staging = marker === 'staging';
    env(staging ? 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING'
        : 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET');
    env(staging ? 'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING'
        : 'BEACON_LISTENER_ACCOUNT_STATE_SECRET');
    const forbidden = staging
        ? ['BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'BEACON_LISTENER_ACCOUNT_STATE_SECRET']
        : ['BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING', 'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING'];
    if (forbidden.some((name) => process.env[name]?.trim())) {
        throw new Error('Listener Account runtime contains secrets for the other environment');
    }
    return true;
}

export function listenerAccountRPConfig(headers: Headers): RPConfig {
    if (!validateListenerAccountRPEnvironment()) throw new Error('Listener Account RP disabled');
    const staging = isListenerStagingHost(headers);
    if (process.env.BEACON_LISTENER_ACCOUNT_ENVIRONMENT !== (staging ? 'staging' : 'production')) {
        throw new Error('Listener Account runtime/Host environment mismatch');
    }
    return {
        issuer: staging
            ? 'https://account-staging.harmonicbeacon.com'
            : 'https://account.harmonicbeacon.com',
        clientId: staging ? 'hb-listener-staging' : 'hb-listener',
        clientSecret: env(staging
            ? 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING'
            : 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET'),
        redirectUri: staging
            ? 'https://earlybirds-staging.harmonicbeacon.com/api/account/callback'
            : 'https://listen.harmonicbeacon.com/api/account/callback',
        stateSecret: env(staging
            ? 'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING'
            : 'BEACON_LISTENER_ACCOUNT_STATE_SECRET'),
    };
}

type Attempt = { state: string; nonce: string; verifier: string; issuedAt: number };

export function localListenerAccountId(issuer: string, subject: string): string {
    if (issuer === 'https://account.harmonicbeacon.com') return subject;
    return `acct_stg_${createHash('sha256').update(`${issuer}\0${subject}`).digest('base64url')}`;
}

function sealAttempt(attempt: Attempt, secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(attempt)), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function openListenerAccountAttempt(value: string | undefined, secret: string): Attempt | null {
    if (!value || value.length > 2048) return null;
    try {
        const [iv, tag, body] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
        decipher.setAuthTag(tag);
        const result = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString()) as Attempt;
        return result.issuedAt >= Date.now() - 10 * 60_000 && result.issuedAt <= Date.now() + 60_000
            ? result : null;
    } catch { return null; }
}

export function createListenerAccountAuthorization(headers: Headers) {
    const config = listenerAccountRPConfig(headers);
    const attempt: Attempt = {
        state: randomBytes(24).toString('base64url'),
        nonce: randomBytes(24).toString('base64url'),
        verifier: randomBytes(48).toString('base64url'),
        issuedAt: Date.now(),
    };
    const challenge = createHash('sha256').update(attempt.verifier).digest('base64url');
    const url = new URL('/api/account/auth/oauth2/authorize', config.issuer);
    url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid profile',
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    }).toString();
    return { url, cookie: sealAttempt(attempt, config.stateSecret) };
}

function basic(config: RPConfig) {
    return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

export async function completeListenerAccountCallback(input: {
    headers: Headers; code: string; state: string; attemptCookie?: string;
}) {
    const config = listenerAccountRPConfig(input.headers);
    const attempt = openListenerAccountAttempt(input.attemptCookie, config.stateSecret);
    if (!attempt || attempt.state !== input.state) return null;
    const tokenResponse = await fetch(new URL('/api/account/auth/oauth2/token', config.issuer), {
        method: 'POST', headers: {
            Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded',
        }, body: new URLSearchParams({
            grant_type: 'authorization_code', code: input.code,
            redirect_uri: config.redirectUri, code_verifier: attempt.verifier,
        }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok) return null;
    const tokens = await tokenResponse.json() as { access_token?: unknown; id_token?: unknown };
    if (typeof tokens.access_token !== 'string' || typeof tokens.id_token !== 'string') return null;
    const verified = await jwtVerify(tokens.id_token,
        createRemoteJWKSet(new URL('/.well-known/jwks.json', config.issuer)), {
            issuer: config.issuer, audience: config.clientId,
        });
    if (verified.payload.nonce !== attempt.nonce || typeof verified.payload.sub !== 'string' ||
        typeof verified.payload.sid !== 'string') return null;
    const introspection = await fetch(new URL('/api/account/auth/oauth2/introspect', config.issuer), {
        method: 'POST', headers: {
            Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded',
        }, body: new URLSearchParams({ token: tokens.access_token }), cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    const active = introspection.ok ? await introspection.json() as Record<string, unknown> : null;
    if (active?.active !== true || active.sub !== verified.payload.sub ||
        active.sid !== verified.payload.sid || active.client_id !== config.clientId) return null;
    const userInfoResponse = await fetch(new URL('/api/account/auth/oauth2/userinfo', config.issuer), {
        headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    const userInfo = userInfoResponse.ok ? await userInfoResponse.json() as Record<string, unknown> : null;
    if (userInfo?.sub !== verified.payload.sub) return null;
    const subject = verified.payload.sub;
    const accountId = localListenerAccountId(config.issuer, subject);
    const displayName = typeof userInfo.name === 'string' && userInfo.name.trim().length <= 60
        ? userInfo.name.trim() : 'Beacon Listener';
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
        await transaction.earlyBirdUser.upsert({
            where: { id: accountId },
            create: {
                id: accountId, name: displayName,
                email: `${createHash('sha256').update(`${config.issuer}:${subject}`).digest('hex')}@account.invalid`,
                emailVerified: false,
            },
            update: { name: displayName },
        });
        await transaction.listenerAccountSubject.upsert({
            where: { issuer_subject: { issuer: config.issuer, subject } },
            create: { accountId, issuer: config.issuer, subject },
            update: {},
        });
        const profileRevision = typeof userInfo.profile_revision === 'number' &&
            Number.isSafeInteger(userInfo.profile_revision) && userInfo.profile_revision >= 1
            ? userInfo.profile_revision : null;
        const localProfile = await transaction.beaconProfile.findUnique({ where: { accountId } });
        if (!localProfile) await transaction.beaconProfile.create({
            data: { accountId, displayName, revision: profileRevision ?? 1 },
        });
        else if (profileRevision !== null && profileRevision > localProfile.revision) {
            await transaction.beaconProfile.update({
                where: { accountId }, data: { displayName, revision: profileRevision },
            });
        }
        await transaction.listenerAccountSession.create({ data: {
            tokenDigest: digestSessionToken(token), accountId,
            issuer: config.issuer, subject, sid: verified.payload.sid as string,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000), lastCheckedAt: now,
        } });
    });
    await emitAnalyticsEvent({
        eventName: 'identity.linked', source: 'listener', surface: 'listen', accountId,
        properties: { link_reason: 'login', auth_method: 'oidc' },
    });
    return { token };
}

export async function currentListenerAccountSession(
    headers: Headers,
) {
    const raw = readListenerAccountCookie(headers);
    if (!raw) return null;
    const config = listenerAccountRPConfig(headers);
    const session = await prisma.listenerAccountSession.findUnique({
        where: { tokenDigest: digestSessionToken(raw) },
        include: { account: { include: { beaconProfile: true } } },
    });
    if (!session || session.issuer !== config.issuer || session.expiresAt <= new Date()) return null;
    if (session.synthetic) {
        return isListenerStagingHost(headers) && process.env.EARLY_BIRDS_TEST_ACCESS_ENABLED === '1'
            ? listenerSessionView(session) : null;
    }
    if (session.lastCheckedAt <= new Date(Date.now() - 5 * 60_000)) {
        const checkStartedAt = new Date();
        const claim = await prisma.listenerAccountSession.updateMany({
            where: {
                id: session.id,
                lastCheckedAt: session.lastCheckedAt,
                OR: [
                    { revalidationLeaseUntil: null },
                    { revalidationLeaseUntil: { lte: checkStartedAt } },
                ],
            },
            data: { revalidationLeaseUntil: new Date(checkStartedAt.getTime() + 5_000) },
        });
        if (claim.count !== 1) {
            // Coalesce behind the winning 4s authority fetch. A lease is never
            // treated as a successful check, and new authorization never falls
            // back to stale local identity merely because another request won.
            const deadline = Date.now() + 4_500;
            while (Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                const refreshed = await prisma.listenerAccountSession.findUnique({
                    where: { id: session.id }, include: { account: { include: { beaconProfile: true } } },
                });
                if (!refreshed) return null;
                if (refreshed.lastCheckedAt > session.lastCheckedAt) return listenerSessionView(refreshed);
                if (!refreshed.revalidationLeaseUntil || refreshed.revalidationLeaseUntil <= new Date()) return null;
            }
            return null;
        }
        let status: Response;
        try {
            status = await fetch(new URL('/api/account/session-status', config.issuer), {
                method: 'POST',
                headers: {
                    Authorization: basic(config),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ sid: session.sid, sub: session.subject }),
                cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4_000),
            });
        } catch {
            // Account outage does not interrupt an already-issued local/media
            // lease. New identity/access decisions fail closed until the next
            // bounded check converges once authority returns.
            await prisma.listenerAccountSession.updateMany({
                where: { id: session.id }, data: { revalidationLeaseUntil: null },
            }).catch(() => undefined);
            return null;
        }
        if (!status.ok) {
            await prisma.listenerAccountSession.updateMany({
                where: { id: session.id }, data: { revalidationLeaseUntil: null },
            });
            return null;
        }
        let state: { active?: boolean; iss?: string; sub?: string; sid?: string };
        try { state = await status.json(); } catch {
            await prisma.listenerAccountSession.updateMany({
                where: { id: session.id }, data: { revalidationLeaseUntil: null },
            });
            return null;
        }
        const activeMatches = state.active === true && state.iss === config.issuer &&
            state.sub === session.subject && state.sid === session.sid;
        if (state.active === false || (state.active === true && !activeMatches) ||
            (state.active !== true && state.active !== false)) {
            await prisma.listenerAccountSession.delete({ where: { id: session.id } });
            return null;
        }
        if (activeMatches) {
            await prisma.listenerAccountSession.update({
                where: { id: session.id }, data: {
                    lastCheckedAt: new Date(), revalidationLeaseUntil: null,
                },
            });
        }
    }
    return listenerSessionView(session);
}

export type LocalListenerNavigationIdentity = {
    displayName: string;
};

/**
 * Host-local presentation for the canonical navigation control. It never
 * revalidates with Account or mutates the session, and it returns no email,
 * subject, sid, token or authorization state.
 */
export async function locallyKnownListenerNavigationIdentity(
    headers: Headers,
    now = new Date(),
): Promise<LocalListenerNavigationIdentity | null> {
    const raw = readListenerAccountCookie(headers);
    if (!raw) return null;
    let config: RPConfig;
    try { config = listenerAccountRPConfig(headers); } catch { return null; }
    const session = await prisma.listenerAccountSession.findUnique({
        where: { tokenDigest: digestSessionToken(raw) },
        select: {
            issuer: true,
            subject: true,
            sid: true,
            synthetic: true,
            expiresAt: true,
            account: {
                select: {
                    name: true,
                    beaconProfile: { select: { displayName: true } },
                },
            },
        },
    });
    if (!session || session.synthetic || session.issuer !== config.issuer ||
        session.subject.length === 0 || session.sid.length === 0 || session.expiresAt <= now) {
        return null;
    }
    return {
        displayName: session.account.beaconProfile?.displayName ?? session.account.name,
    };
}

/** Boolean-only compatibility wrapper for callers that need no presentation. */
export async function locallyKnownListenerAccountSession(
    headers: Headers,
    now = new Date(),
): Promise<boolean> {
    return Boolean(await locallyKnownListenerNavigationIdentity(headers, now));
}

type ListenerSessionWithAccount = Prisma.ListenerAccountSessionGetPayload<{
    include: { account: { include: { beaconProfile: true } } };
}>;

function listenerSessionView(session: ListenerSessionWithAccount) {
    return {
        user: {
            id: session.accountId,
            name: session.account.beaconProfile?.displayName ?? session.account.name,
            email: session.account.email,
            image: session.account.image,
        },
        session: { id: session.id, expiresAt: session.expiresAt },
    };
}

export async function revokeCurrentListenerAccountSession(headers: Headers) {
    const session = await currentListenerAccountSession(headers);
    if (session) await prisma.listenerAccountSession.delete({ where: { id: session.session.id } });
}

export function listenerAccountCookie(value: string, maxAge = 30 * 24 * 60 * 60) {
    return `${LISTENER_ACCOUNT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function listenerAttemptCookie(value: string, maxAge = 10 * 60) {
    return `${LISTENER_ACCOUNT_ATTEMPT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function listenerAutomaticHandoffCookie(value: '' | '1', maxAge = 10 * 60) {
    return `${LISTENER_ACCOUNT_AUTO_HANDOFF_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
