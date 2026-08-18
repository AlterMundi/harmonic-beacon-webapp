import { timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/db';
import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import {
    accountEnvironment,
    accountOrigin,
    accountRateSecret,
    accountStaticClientSecrets,
    activeAccountStaticClients,
    isAccountHost,
} from '@/lib/account/config';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';

function credentials(request: Request) {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Basic ')) return null;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        return separator > 0 ? {
            clientId: decoded.slice(0, separator),
            secret: decoded.slice(separator + 1),
        } : null;
    } catch { return null; }
}

function equal(left: string, right: string) {
    const a = Buffer.from(left); const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host) ||
        !await accountAuthorityDatabaseReady()) return new Response(null, { status: 404 });
    if (request.headers.get('content-type') !== 'application/x-www-form-urlencoded') {
        return Response.json({ active: false }, {
            status: 415, headers: { 'Cache-Control': 'no-store' },
        });
    }
    const presented = credentials(request);
    const active = activeAccountStaticClients();
    const secrets = accountStaticClientSecrets();
    const definition = presented && active.find((client) => client.clientId === presented.clientId);
    const expected = definition && secrets.find((client) => client.clientId === definition.clientId)?.clientSecret;
    if (!presented || !definition || !expected || !equal(presented.secret, expected)) {
        return Response.json({ active: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const body = await request.formData().catch(() => null);
    const sid = body?.get('sid'); const sub = body?.get('sub');
    if (typeof sid !== 'string' || typeof sub !== 'string' || sid.length > 128 || sub.length > 256) {
        return Response.json({ active: false }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const rateSecret = accountRateSecret();
    if (!rateSecret || !await consumeAccountRateLimit({
        request, email: sub, purpose: `session-status-${definition.clientId}`,
        secret: rateSecret, maxPerEmail: 100, maxGlobal: 100_000,
        includeOriginBucket: false,
    })) return Response.json({ active: false }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
    const session = await prisma.earlyBirdAuthSession.findUnique({
        where: { id: sid }, select: {
            userId: true, expiresAt: true, securityRevision: true, authorityEnvironment: true,
            user: { select: { securityRevision: true } },
        },
    });
    const isActive = Boolean(session && session.userId === sub && session.expiresAt > new Date() &&
        session.securityRevision === session.user.securityRevision &&
        session.authorityEnvironment === accountEnvironment());
    return Response.json(isActive
        ? { active: true, iss: accountOrigin(), sub, sid }
        : { active: false }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
