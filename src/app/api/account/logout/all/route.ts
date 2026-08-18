import { prisma } from '@/lib/db';
import { currentAccountSession } from '@/lib/account/auth';
import {
    ACCOUNT_SESSION_COOKIE, activeAccountStaticClients, accountOrigin,
    accountStaticClientSecrets, isAccountHost,
} from '@/lib/account/config';
import { accountFrontchannelURL } from '@/lib/account/frontchannel-token';
import { accountLogoutInitiationValid } from '@/lib/account/logout-initiation';
import { revokeAllAccountSessions } from '@/lib/account/revocation';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const session = await currentAccountSession(request.headers);
    if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { initiation?: unknown } | null;
    if (body && Object.prototype.hasOwnProperty.call(body, 'initiation') &&
        typeof body.initiation !== 'string') return Response.json({ error: 'invalid_initiation' }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
    });
    const initiation = typeof body?.initiation === 'string' ? body.initiation : undefined;
    if (!accountLogoutInitiationValid({
        token: initiation, sid: session.session.id, mode: 'all',
    })) return Response.json({ error: 'invalid_initiation' }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
    });
    const secrets = new Map(accountStaticClientSecrets().map((client) => [client.clientId, client.clientSecret]));
    const frontchannel = activeAccountStaticClients().flatMap((client) => {
        const clientSecret = secrets.get(client.clientId);
        return clientSecret ? [accountFrontchannelURL({
            url: client.postLogoutRedirectUri, issuer: accountOrigin(),
            audience: client.clientId, sid: session.session.id, clientSecret,
        })] : [];
    });
    await prisma.$transaction(async (transaction) => {
        await transaction.earlyBirdUser.update({
            where: { id: session.user.id }, data: { securityRevision: { increment: 1 } },
        });
        await revokeAllAccountSessions(transaction, session.user.id);
    });
    return Response.json({
        frontchannel,
    }, { headers: {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': `${ACCOUNT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    } });
}
