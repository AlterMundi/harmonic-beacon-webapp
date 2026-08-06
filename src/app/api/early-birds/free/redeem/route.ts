import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    EarlyBirdMembershipGatewayUnavailableError,
    redeemFreeThroughCanonicalGateway,
} from '@/lib/early-birds/membership-gateway';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    let token: string;
    try {
        const body = await request.json() as { token?: unknown };
        token = typeof body.token === 'string' ? body.token : '';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (token.length < 32 || token.length > 512) {
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
    return NextResponse.json({
        ok: true,
        landing: '/early-birds/home',
        replayed: result.replayed,
        alreadyEntitled: result.alreadyEntitled,
    });
}
