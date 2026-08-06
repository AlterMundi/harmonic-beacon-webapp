import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';
import {
    canonicalEarlyBirdInvitation,
    clearedEarlyBirdInvitationCookie,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import {
    EarlyBirdMembershipGatewayUnavailableError,
    redeemFreeThroughCanonicalGateway,
} from '@/lib/early-birds/membership-gateway';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();

    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    const token = canonicalEarlyBirdInvitation(
        request.cookies.get(EARLY_BIRD_INVITATION_COOKIE)?.value,
    );
    if (!token) {
        return NextResponse.json({ error: 'Invitation unavailable.' }, { status: 409 });
    }

    let result;
    try {
        result = await redeemFreeThroughCanonicalGateway(session.user.id, token);
    } catch (error) {
        if (error instanceof EarlyBirdMembershipGatewayUnavailableError) {
            return NextResponse.json({ error: 'Membership service unavailable.' }, { status: 503 });
        }
        return NextResponse.json({ error: 'Membership service unavailable.' }, { status: 503 });
    }
    if (!result.ok) {
        return NextResponse.json({ error: 'Invitation unavailable.' }, { status: 409 });
    }
    const response = NextResponse.json({
        ok: true,
        landing: '/early-birds/home',
        replayed: result.replayed,
        alreadyEntitled: result.alreadyEntitled,
    });
    response.cookies.set(clearedEarlyBirdInvitationCookie());
    return response;
}
