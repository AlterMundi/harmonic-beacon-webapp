import { after } from 'next/server';
import { Prisma } from '@prisma/client';

import { accountAuth } from '@/lib/account/auth';
import { prisma } from '@/lib/db';
import {
    accountEnvironment,
    accountOrigin,
    ACCOUNT_SESSION_COOKIE,
    activeAccountStaticClients,
} from '@/lib/account/config';
import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import { accountCredentialRequestAllowed, accountRequestAllowed } from '@/lib/account/request-boundary';
import { accountEndSessionRequest } from '@/lib/account/request-boundary';
import { accountFrontchannelURL } from '@/lib/account/frontchannel-token';
import { revokeAccountSession } from '@/lib/account/revocation';
import { enforceAccountCredentialFloor } from '@/lib/account/timing';
import {
    ensureVerificationMailQueued,
    processVerificationMailOutbox,
} from '@/lib/account/mail-outbox';

async function safeRPRedirect(response: Response): Promise<string | null> {
    const body = await response.clone().json().catch(() => null) as {
        url?: unknown; redirect_uri?: unknown;
    } | null;
    // Better Auth can preserve the credential callback (`/account`) in the
    // Location header while returning the completed OAuth RP callback in its
    // JSON body. A non-RP Location must not shadow a later valid RP result.
    const candidates = [
        response.headers.get('location'),
        typeof body?.redirect_uri === 'string' ? body.redirect_uri : null,
        typeof body?.url === 'string' ? body.url : null,
    ];
    const clients = activeAccountStaticClients();
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const parsed = new URL(candidate);
            if (!parsed.username && !parsed.password && !parsed.hash && clients.some((client) => {
                const registered = new URL(client.redirectUri);
                return registered.origin === parsed.origin && registered.pathname === parsed.pathname;
            })) return parsed.toString();
        } catch { /* Continue to the provider's next result shape. */ }
    }
    return null;
}

async function genericCredentialResponse(response: Response, path: string): Promise<Response> {
    const signup = path === '/api/account/auth/sign-up/email';
    const successful = response.ok;
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    if (successful && !signup) {
        for (const cookie of response.headers.getSetCookie()) {
            headers.append('Set-Cookie', cookie);
        }
    }
    const redirect = successful && !signup ? await safeRPRedirect(response) : null;
    return Response.json({
        status: signup ? 'accepted' : successful ? 'authenticated' : 'unavailable',
        ...(redirect ? { redirect } : {}),
    }, {
        status: signup ? 202 : successful ? 200 : 401,
        headers,
    });
}

async function credentialSignInRevisionStillValid(input: {
    request: Request;
    response: Response;
    accountId: string;
    securityRevision: number;
}): Promise<boolean> {
    if (!input.response.ok) return true;
    const sessionCookies = input.response.headers.getSetCookie().filter((cookie) =>
        cookie.startsWith(`${ACCOUNT_SESSION_COOKIE}=`));
    const body = await input.response.clone().json().catch(() => null) as { token?: unknown } | null;
    const bodyToken = typeof body?.token === 'string' && body.token.length <= 512
        ? body.token : null;
    if (sessionCookies.length !== 1) {
        if (bodyToken) {
            await prisma.earlyBirdAuthSession.deleteMany({ where: { token: bodyToken } })
                .catch(() => undefined);
        }
        return false;
    }
    const token = sessionCookies[0].slice(ACCOUNT_SESSION_COOKIE.length + 1).split(';', 1)[0];
    if (!token) return false;
    const headers = new Headers(input.request.headers);
    headers.set('cookie', `${ACCOUNT_SESSION_COOKIE}=${token}`);
    const created = await accountAuth().api.getSession({ headers }).catch(() => null);
    if (!created || created.user.id !== input.accountId) {
        // Better Auth may have persisted a session before an output seam
        // failed. Delete only the exact token it just returned; never revoke
        // pre-existing sessions for the account.
        if (bodyToken) {
            await prisma.earlyBirdAuthSession.deleteMany({ where: { token: bodyToken } })
                .catch(() => undefined);
        }
        return false;
    }
    return prisma.$transaction(async (transaction) => {
        // This lock gives reset/change a total order with the final sign-in
        // check. If sign-in wins, the later mutation revokes this session; if
        // the mutation wins, the old-password sign-in is rejected here.
        await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${input.accountId} FOR UPDATE`;
        const persisted = await transaction.earlyBirdAuthSession.findUnique({
            where: { id: created.session.id },
            select: {
                id: true, userId: true, securityRevision: true,
                user: { select: { securityRevision: true } },
            },
        });
        const valid = Boolean(persisted && persisted.userId === input.accountId &&
            persisted.securityRevision === input.securityRevision &&
            persisted.user.securityRevision === input.securityRevision);
        if (!valid && persisted) {
            await transaction.earlyBirdAuthSession.deleteMany({ where: { id: persisted.id } });
        }
        return valid;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function handler(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const path = new URL(request.url).pathname;
    const credentialRequest = request.method === 'POST' &&
        (path === '/api/account/auth/sign-up/email' || path === '/api/account/auth/sign-in/email');
    const credentialBody = credentialRequest
        ? await request.clone().json().catch(() => null) as { email?: unknown } | null
        : null;
    if (!await accountAuthorityDatabaseReady()) {
        return Response.json({ error: 'service_unavailable' }, {
            status: 503, headers: { 'Cache-Control': 'no-store' },
        });
    }
    if (!await accountRequestAllowed(request)) {
        return Response.json({ error: 'not_found' }, {
            status: 404,
            headers: { 'Cache-Control': 'no-store' },
        });
    }
    if (!await accountCredentialRequestAllowed(request)) {
        if (credentialRequest) await enforceAccountCredentialFloor(startedAt);
        return Response.json({ error: 'request_unavailable' }, {
            status: 429,
            headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
        });
    }
    const revisionFence = path === '/api/account/auth/sign-in/email' &&
        typeof credentialBody?.email === 'string'
        ? await prisma.earlyBirdUser.findUnique({
            where: { email: credentialBody.email.trim().toLowerCase() },
            select: { id: true, securityRevision: true },
        })
        : null;
    const browserSession = await accountAuth().api.getSession({ headers: request.headers });
    if (browserSession) {
        const persisted = await prisma.earlyBirdAuthSession.findUnique({
            where: { id: browserSession.session.id }, select: { authorityEnvironment: true },
        });
        if (persisted?.authorityEnvironment !== accountEnvironment()) {
            return Response.json({ error: 'invalid_session' }, {
                status: 401, headers: { 'Cache-Control': 'no-store' },
            });
        }
    }
    let response = await accountAuth().handler(request);
    if (path === '/api/account/auth/oauth2/end-session') {
        const admitted = accountEndSessionRequest(request);
        if (!admitted || response.status < 200 || response.status >= 400) return response;
        try {
            // oauth-provider 1.6.30 treats session deletion as best-effort.
            // Frontchannel success is stricter: only advertise logout after our
            // own transaction has removed the exact sid and its bearer tokens.
            await prisma.$transaction(async (transaction) => {
                await revokeAccountSession(transaction, admitted.sid);
            });
        } catch {
            return Response.json({ error: 'service_unavailable' }, {
                status: 503, headers: { 'Cache-Control': 'private, no-store' },
            });
        }
        const signed = new URL(accountFrontchannelURL({
            url: admitted.postLogoutRedirectUri,
            issuer: accountOrigin(),
            audience: admitted.clientId,
            sid: admitted.sid,
            clientSecret: admitted.clientSecret,
        }));
        signed.searchParams.set('state', admitted.state);
        return new Response(null, {
            status: 302,
            headers: {
                Location: signed.toString(),
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer',
            },
        });
    }
    if (!credentialRequest) return response;
    if (revisionFence && !await credentialSignInRevisionStillValid({
        request, response,
        accountId: revisionFence.id,
        securityRevision: revisionFence.securityRevision,
    })) {
        response = Response.json({ error: 'request_unavailable' }, {
            status: 401, headers: { 'Cache-Control': 'private, no-store' },
        });
    }
    if (path === '/api/account/auth/sign-up/email' && typeof credentialBody?.email === 'string') {
        const explicitLocale = request.headers.get('x-hb-locale');
        const locale = explicitLocale === 'es' || explicitLocale === 'en'
            ? explicitLocale
            : request.headers.get('accept-language')?.toLowerCase().startsWith('es')
                ? 'es' as const : 'en' as const;
        await ensureVerificationMailQueued(credentialBody.email, locale).catch(() => undefined);
        after(async () => { await processVerificationMailOutbox().catch(() => undefined); });
    }
    await enforceAccountCredentialFloor(startedAt);
    return genericCredentialResponse(response, path);
}

export const GET = handler;
export const POST = handler;
