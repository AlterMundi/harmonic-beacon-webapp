import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';

export async function GET() {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return NextResponse.json(
            { error: 'LiveKit API credentials not configured' },
            { status: 500 }
        );
    }

    const identity = `listener-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name: 'Beacon Listener',
        ttl: '24h',
    });

    token.addGrant({
        roomJoin: true,
        room: ROOM_NAME,
        canPublish: false,
        canSubscribe: true,
    });

    const jwt = await token.toJwt();

    return NextResponse.json({ token: jwt, identity, room: ROOM_NAME });
}
