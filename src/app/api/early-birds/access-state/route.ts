import { NextRequest, NextResponse } from 'next/server';

import {
    getEarlyBirdListeningAccess,
    serializeEarlyBirdListeningAccess,
} from '@/lib/early-birds/access';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: PRIVATE_HEADERS });
    }
    try {
        const access = await getEarlyBirdListeningAccess(session.user.id);
        return NextResponse.json({
            serverNow: access.serverNow.toISOString(),
            access: serializeEarlyBirdListeningAccess(access),
        }, { headers: PRIVATE_HEADERS });
    } catch {
        return NextResponse.json({ error: 'Listener access unavailable.' }, {
            status: 503,
            headers: PRIVATE_HEADERS,
        });
    }
}
