import { NextRequest, NextResponse } from 'next/server';

import { closeLivePresence, observeLivePresence } from '@/lib/live-presence';
import { resolveRoomViewer } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const entitlement = await resolveRoomViewer(request, id);
    if (!entitlement.ok) {
        return NextResponse.json({ error: entitlement.error }, { status: entitlement.status, headers: PRIVATE_NO_STORE });
    }
    let state: 'connected' | 'left';
    let reconnect = false;
    try {
        const body = await request.json() as { state?: unknown; reconnect?: unknown };
        if (Object.keys(body).some(key => key !== 'state' && key !== 'reconnect')) {
            return NextResponse.json({ error: 'Unknown presence field' }, { status: 400, headers: PRIVATE_NO_STORE });
        }
        if (body.state !== 'connected' && body.state !== 'left') {
            return NextResponse.json({ error: 'Invalid presence state' }, { status: 400, headers: PRIVATE_NO_STORE });
        }
        state = body.state;
        reconnect = body.reconnect === true;
    } catch {
        return NextResponse.json({ error: 'Malformed request' }, { status: 400, headers: PRIVATE_NO_STORE });
    }
    const principal = entitlement.principal;
    if (state === 'left') {
        await closeLivePresence({ scheduledSessionId: id, participantIdentity: principal.identity, reason: 'left' });
    } else {
        await observeLivePresence({ scheduledSessionId: id, participantIdentity: principal.identity, reconnect });
    }
    return NextResponse.json({ accepted: true }, { status: 202, headers: PRIVATE_NO_STORE });
}
