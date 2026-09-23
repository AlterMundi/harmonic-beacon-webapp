import { timingSafeEqual } from 'node:crypto';

import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import {
    accountRateSecret,
    accountStaticClientSecrets,
    activeAccountStaticClients,
    isAccountHost,
} from '@/lib/account/config';
import { prisma } from '@/lib/db';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';

function noStore(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function confidentialClient(request: Request): { clientId: string; secret: string } | null {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Basic ')) return null;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        return separator > 0 ? {
            clientId: decoded.slice(0, separator), secret: decoded.slice(separator + 1),
        } : null;
    } catch { return null; }
}

function equal(left: string, right: string): boolean {
    const first = Buffer.from(left); const second = Buffer.from(right);
    return first.length === second.length && timingSafeEqual(first, second);
}

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host) ||
        !await accountAuthorityDatabaseReady()) return new Response(null, { status: 404 });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        return noStore({ error: 'invalid_request' }, 415);
    }
    const presented = confidentialClient(request);
    const definition = presented && activeAccountStaticClients().find((client) =>
        client.clientId === presented.clientId &&
        (client.clientId === 'hb-live' || client.clientId === 'hb-live-staging'));
    const expected = definition && accountStaticClientSecrets().find((client) =>
        client.clientId === definition.clientId)?.clientSecret;
    if (!presented || !definition || !expected || !equal(presented.secret, expected)) {
        return noStore({ error: 'unauthorized' }, 401);
    }
    const body = await request.json().catch(() => null) as { sub?: unknown } | null;
    const sub = typeof body?.sub === 'string' ? body.sub : null;
    if (!sub || sub.length > 256) return noStore({ error: 'invalid_request' }, 400);
    const rateSecret = accountRateSecret();
    if (!rateSecret || !await consumeAccountRateLimit({
        request, email: sub, purpose: `admin-profile-${definition.clientId}`,
        secret: rateSecret, maxPerEmail: 100, maxGlobal: 100_000,
        includeOriginBucket: false,
    })) return noStore({ error: 'rate_limited' }, 429);
    const account = await prisma.earlyBirdUser.findUnique({
        where: { id: sub },
        select: {
            id: true, email: true, emailVerified: true,
            beaconProfile: { select: { displayName: true, realName: true } },
        },
    });
    if (!account?.beaconProfile) return noStore({ error: 'not_found' }, 404);
    return noStore({
        sub: account.id,
        preferredName: account.beaconProfile.displayName,
        realName: account.beaconProfile.realName,
        email: account.email.endsWith('@identity.invalid') ? null : account.email,
        emailVerified: account.emailVerified && !account.email.endsWith('@identity.invalid'),
    });
}
