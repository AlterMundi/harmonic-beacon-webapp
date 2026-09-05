import { NextRequest, NextResponse } from 'next/server';

import { resolveRoomPrincipal } from '@/lib/room-entitlement';
import { activateRoomPublication } from '@/lib/room-token-issue';
import { redactError } from '@/lib/redact';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

function response(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Project an already-authorized publication grant onto the caller's connected
 * current LiveKit identity. The join JWT itself is always subscribe-only.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const entitlement = await resolveRoomPrincipal(request, id);
    if (!entitlement.ok) {
        return response({ error: entitlement.error }, entitlement.status);
    }
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookieValue || !entitlement.principal.canPublish) {
        return response({ error: 'Not authorized' }, 403);
    }

    try {
        const activated = await activateRoomPublication({
            cookieValue,
            principal: entitlement.principal,
            expectedIdentity: entitlement.principal.identity,
        });
        if (!activated) return response({ error: 'Not authorized' }, 403);
        return response({ canPublish: true });
    } catch (error) {
        console.error(`[room-publication] activation failed: ${redactError(error)}`);
        return response({ error: 'Unable to activate publication' }, 502);
    }
}
