import { NextResponse } from 'next/server';

import { currentAccountSession } from '@/lib/account/auth';
import { emitAnalyticsEvent } from '@/lib/analytics-server';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { isAccountHost } from '@/lib/account/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    if (Object.keys(values).some((key) => !['visitor_id', 'session_id'].includes(key)) ||
        typeof values.visitor_id !== 'string' || !UUID.test(values.visitor_id) ||
        typeof values.session_id !== 'string' || !UUID.test(values.session_id)) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const headers = new Headers(request.headers);
    const accountId = isAccountHost(headers.get('host'))
        ? (await currentAccountSession(headers).catch(() => null))?.user.id
        : (await currentEarlyBirdSession(headers).catch(() => null))?.user.id;
    if (!accountId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // This endpoint links opaque browser IDs to the authenticated account. It
    // never returns or exposes the server-side account subject to the browser.
    await emitAnalyticsEvent({
        eventName: 'identity.linked', source: 'account', surface: isAccountHost(headers.get('host')) ? 'account' : 'listen',
        accountId, visitorId: values.visitor_id, sessionId: values.session_id,
        properties: { link_reason: 'login' },
    });
    return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
