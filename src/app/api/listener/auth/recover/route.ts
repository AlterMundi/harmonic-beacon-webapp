import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { signAccountLogoutInitiation } from '@/lib/account/frontchannel-token';
import {
    listenerAccountCookie,
    listenerAccountRPConfig,
    readListenerAccountCookie,
} from '@/lib/listener/account-rp';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';
import { digestSessionToken } from '@/lib/session-auth';

export async function POST(request: NextRequest): Promise<Response> {
    const headers = new Headers(request.headers);
    const listenerHost = isCanonicalListenerHost(headers) || isListenerStagingHost(headers);
    if (!listenerHost || request.headers.get('origin') !== request.nextUrl.origin ||
        request.headers.get('sec-fetch-site') !== 'same-origin' ||
        request.headers.get('content-type') !== 'application/json') {
        return new Response(null, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const body = await request.json().catch(() => null) as { mode?: unknown; locale?: unknown } | null;
    const mode = body?.mode === 'all' ? 'all' as const : 'current' as const;
    const locale = body?.locale === 'es' ? 'es' : 'en';
    const raw = readListenerAccountCookie(request.headers);
    const config = listenerAccountRPConfig(headers);
    const local = raw ? await prisma.listenerAccountSession.findUnique({
        where: { tokenDigest: digestSessionToken(raw) },
        select: { id: true, issuer: true, sid: true },
    }) : null;
    const responseHeaders = new Headers({
        'Cache-Control': 'private, no-store',
        'Set-Cookie': listenerAccountCookie('', 0),
    });
    const returnTo = isListenerStagingHost(headers)
        ? 'https://earlybirds-staging.harmonicbeacon.com/'
        : 'https://listen.harmonicbeacon.com/';
    if (!local || local.issuer !== config.issuer) {
        // Without a local sid Account must ask for an explicit confirmation;
        // a cross-site navigation can never auto-revoke the central session.
        const confirmation = new URL('/account/logout', config.issuer);
        confirmation.searchParams.set('mode', mode);
        confirmation.searchParams.set('return_to', returnTo);
        confirmation.searchParams.set('lang', locale);
        return NextResponse.json({ url: confirmation.toString(), confirmation: true }, {
            headers: responseHeaders,
        });
    }
    await prisma.listenerAccountSession.deleteMany({ where: { id: local.id, sid: local.sid } });
    const initiation = signAccountLogoutInitiation({
        issuer: config.issuer, clientId: config.clientId, clientSecret: config.clientSecret,
        sid: local.sid, mode, returnTo,
    });
    const target = new URL('/account/logout', config.issuer);
    target.searchParams.set('mode', mode);
    target.searchParams.set('return_to', returnTo);
    target.searchParams.set('lang', locale);
    target.searchParams.set('initiation', initiation);
    return NextResponse.json({ url: target.toString() }, { headers: responseHeaders });
}

export function GET(): Response {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' } });
}
