import { NextRequest, NextResponse } from 'next/server';

import { isCanonicalListenerHost } from '@/lib/listener/public-discovery';
import { renderListenerSessionCookieObservations } from '@/lib/listener/session-cookie-observability';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Aggregate Listener session-cookie compatibility observations for the
 * rollback-support window. GET-only, loopback-operated: the public nginx
 * templates do not expose this path, and the route additionally answers 404
 * on any Host other than the canonical Listener host (the request Host
 * header, never a forwarded one). No database, no authentication, no request
 * metadata and no dynamic labels: the output is the fixed nine-state counter
 * exposition plus the process-start gauge, and it carries no cookie, header,
 * user, session, account, IP or user-agent material.
 */
export function GET(request: NextRequest): Response {
    if (!isCanonicalListenerHost(request.headers)) {
        return NextResponse.json({ error: 'Resource not found.' }, { status: 404, headers: NO_STORE });
    }
    try {
        return new Response(renderListenerSessionCookieObservations(), {
            status: 200,
            headers: {
                'content-type': 'text/plain; version=0.0.4; charset=utf-8',
                'cache-control': 'private, no-store',
            },
        });
    } catch {
        return NextResponse.json(
            { error: 'Session-cookie observations unavailable.' },
            { status: 503, headers: NO_STORE },
        );
    }
}
