import { NextRequest, NextResponse } from 'next/server';

import {
    bedRoomIdentity,
    createBedToken,
} from '@/lib/livekit-server';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';

const BED_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';

/**
 * Issue an audio-only, subscribe-only connection to the configured Beacon bed.
 * sessionId is mandatory so this endpoint performs the exact same current
 * entitlement check as the stage token.
 */
export async function GET(request: NextRequest) {
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
    if (!sessionId) {
        return NextResponse.json(
            { error: 'sessionId is required' },
            { status: 400 },
        );
    }

    const entitlement = await resolveRoomPrincipal(request, sessionId);
    if (!entitlement.ok) {
        return NextResponse.json(
            { error: entitlement.error },
            { status: entitlement.status },
        );
    }

    try {
        const identity = bedRoomIdentity(entitlement.principal.identity);
        const token = await createBedToken(BED_ROOM_NAME, identity);
        return NextResponse.json({
            token,
            identity,
            room: BED_ROOM_NAME,
            canPublish: false,
        });
    } catch {
        return NextResponse.json(
            { error: 'LiveKit API credentials not configured' },
            { status: 500 },
        );
    }
}
