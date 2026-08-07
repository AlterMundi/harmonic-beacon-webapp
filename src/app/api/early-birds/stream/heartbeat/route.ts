import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import {
    EarlyBirdAccessDeniedError,
    EarlyBirdLeaseInactiveError,
    heartbeatFreeForAllStreamLease,
    heartbeatEarlyBirdStreamLease,
} from '@/lib/early-birds/stream';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();

    const freeForAll = earlyBirdsFreeForAll();
    const session = freeForAll
        ? null
        : await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!freeForAll && !session) {
        return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    }

    let leaseId: string;
    let intent: 'play' | 'prepare';
    try {
        const body = await request.json() as { leaseId?: unknown; intent?: unknown };
        leaseId = typeof body.leaseId === 'string' ? body.leaseId : '';
        intent = body.intent === 'prepare' ? 'prepare' : 'play';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
        return NextResponse.json({ error: 'Invalid lease.' }, { status: 400 });
    }

    try {
        const grant = freeForAll
            ? await heartbeatFreeForAllStreamLease(leaseId)
            : await heartbeatEarlyBirdStreamLease(
                session!.user.id,
                leaseId,
                undefined,
                undefined,
                intent === 'play',
            );
        return NextResponse.json({
            leaseExpiresAt: grant.leaseExpiresAt.toISOString(),
            stream: {
                manifestUrl: grant.stream.manifestUrl,
                expiresAt: grant.stream.expiresAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof EarlyBirdLeaseInactiveError) {
            const reason = error.reason === 'evicted'
                ? 'displaced'
                : error.reason === 'expired' ? 'expired' : 'inactive';
            return NextResponse.json({
                error: reason === 'displaced'
                    ? 'Device displaced.'
                    : reason === 'expired' ? 'Listening lease expired.' : 'Listening lease inactive.',
                reason,
            }, { status: 410 });
        }
        if (error instanceof EarlyBirdAccessDeniedError) {
            return NextResponse.json({ error: 'Membership inactive.' }, { status: 403 });
        }
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
    }
}
