import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { requireAuth, isAdminOrProvider } from '@/lib/auth';
import { redactErrorDetail } from '@/lib/redact';
import { features } from '@/lib/features';

export const dynamic = 'force-dynamic';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';

/**
 * Two hours. Long enough for a listening session, short enough that a leaked
 * token is not a standing key to the room. An established connection is not
 * dropped when its token expires — the TTL governs the join — so this only
 * bounds how long a copied token stays usable.
 */
const TOKEN_TTL = '2h';

/**
 * GET /api/livekit/token
 * Mints a subscribe-only token for the live beacon room.
 *
 * Authenticated. Listening is free (BUSINESS_RULES.md §5.1) and this does not
 * change that — `/live` already required a session, so nothing that used to work
 * stops working. What it stops is an unauthenticated caller minting room
 * credentials at will: the endpoint issues real credentials against a
 * third-party service, and on a metered plan that is a direct spend.
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    // First-iteration (WS0): the public beacon is hidden, so don't mint beacon
    // credentials for listeners even if they hit the endpoint directly. Providers
    // and admins keep access to preview. Re-enabled by NEXT_PUBLIC_SHOW_LIVE.
    if (!features.showLive && !isAdminOrProvider(session.user.role)) {
        return NextResponse.json({ error: 'The beacon is not publicly available' }, { status: 403 });
    }

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return NextResponse.json(
            { error: 'LiveKit API credentials not configured' },
            { status: 500 }
        );
    }

    try {
        // Deliberately opaque, and deliberately NOT derived from the user.
        //
        // Participant identities are visible to every other participant in the
        // room, so a stable per-user identity would let listeners recognise each
        // other across sessions — a privacy regression in a room whose whole
        // premise is anonymous shared presence. The auth check above is what
        // bounds abuse; the identity does not need to carry it.
        //
        // A fresh value per token also avoids the identity collision that would
        // disconnect a listener's other tab, since LiveKit evicts an existing
        // connection when the same identity joins again.
        const identity = `listener-${crypto.randomUUID()}`;

        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity,
            name: 'Beacon Listener',
            ttl: TOKEN_TTL,
        });

        token.addGrant({
            roomJoin: true,
            room: ROOM_NAME,
            canPublish: false,
            canSubscribe: true,
        });

        const jwt = await token.toJwt();

        return NextResponse.json({ token: jwt, identity, room: ROOM_NAME });
    } catch (error) {
        console.error('LiveKit token minting failed:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 });
    }
}
