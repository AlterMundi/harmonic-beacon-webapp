import { NextRequest, NextResponse } from 'next/server';

import { closeLivePresence, observeLivePresence } from '@/lib/live-presence';
import { resolveRoomViewer } from '@/lib/room-entitlement';
import { isPresenceWriteConflict } from '@/lib/presence-transaction';

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
    try {
        if (state === 'left') {
            await closeLivePresence({ scheduledSessionId: id, participantIdentity: principal.identity, reason: 'left' });
        } else {
            await observeLivePresence({ scheduledSessionId: id, participantIdentity: principal.identity, reconnect });
        }
    } catch (error) {
        // Bounded, route-specific diagnostics without identity, SQL or credentials.
        console.error('[live-presence]', isPresenceWriteConflict(error) ? 'write_conflict_exhausted' : 'write_unavailable');
        return NextResponse.json({ accepted: false, error: 'presence_unavailable' }, {
            status: 503, headers: { ...PRIVATE_NO_STORE, 'Retry-After': '1' },
        });
    }
    return NextResponse.json(
        { accepted: true, maxPublishers: principal.session.maxPublishers },
        { status: 202, headers: PRIVATE_NO_STORE },
    );
}
