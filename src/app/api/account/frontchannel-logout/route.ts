import { prisma } from '@/lib/db';
import { verifyAccountFrontchannelLogout } from '@/lib/account/frontchannel-token';
import {
    listenerAccountCookie,
    listenerAutomaticHandoffCookie,
    listenerAccountRPConfig,
} from '@/lib/listener/account-rp';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

export async function GET(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    if (!isCanonicalListenerHost(headers) && !isListenerStagingHost(headers)) {
        return new Response(null, { status: 404 });
    }
    const config = listenerAccountRPConfig(headers);
    const token = new URL(request.url).searchParams.get('logout_token') ?? '';
    const authority = verifyAccountFrontchannelLogout({
        token, issuer: config.issuer, audience: config.clientId,
        clientSecret: config.clientSecret,
    });
    if (!authority) return new Response(null, {
        status: 400, headers: { 'Cache-Control': 'private, no-store' },
    });
    // This endpoint is loaded in a cross-site hidden iframe, so SameSite=Lax
    // correctly withholds the Listener cookie. The signed issuer/sid binding is
    // the revocation authority; clearing the browser cookie remains best-effort.
    await prisma.listenerAccountSession.deleteMany({
        where: { issuer: authority.iss, sid: authority.sid },
    });
    const responseHeaders = new Headers({
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': `default-src 'none'; frame-ancestors ${config.issuer}`,
    });
    responseHeaders.append('Set-Cookie', listenerAccountCookie('', 0));
    responseHeaders.append('Set-Cookie', listenerAutomaticHandoffCookie('1'));
    return new Response(null, {
        status: 204,
        headers: responseHeaders,
    });
}
