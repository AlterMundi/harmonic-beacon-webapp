import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import {
    acquireEarlyBirdStreamLease,
    acquireFreeForAllStreamLease,
    claimEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdDeviceCapacityError,
    EarlyBirdStreamIssuerUnavailableError,
    prepareEarlyBirdStreamLease,
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

    let deviceId: string;
    let intent: 'play' | 'prepare' | 'claim';
    try {
        const body = await request.json() as { deviceId?: unknown; intent?: unknown };
        deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
        intent = body.intent === 'prepare'
            ? 'prepare'
            : body.intent === 'claim' ? 'claim' : 'play';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    try {
        const grant = freeForAll
            ? await acquireFreeForAllStreamLease(deviceId)
            : intent === 'prepare'
                ? await prepareEarlyBirdStreamLease(session!.user.id, deviceId)
                : intent === 'claim'
                    ? await claimEarlyBirdStreamLease(session!.user.id, deviceId)
                : await acquireEarlyBirdStreamLease(session!.user.id, deviceId);
        return NextResponse.json({
            serverNow: grant.serverNow.toISOString(),
            accessKind: grant.accessKind,
            quota: grant.quota,
            leaseId: grant.leaseId,
            leaseGeneration: grant.leaseGeneration,
            presenceSequence: grant.presenceSequence,
            leaseExpiresAt: grant.leaseExpiresAt.toISOString(),
            evictedAnotherDevice: grant.evictedLeaseId !== null,
            stream: {
                manifestUrl: grant.stream.manifestUrl,
                expiresAt: grant.stream.expiresAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof EarlyBirdAccessDeniedError) {
            return NextResponse.json({ error: 'Listening access inactive.' }, { status: 403 });
        }
        if (error instanceof EarlyBirdStreamIssuerUnavailableError) {
            return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
        }
        if (error instanceof EarlyBirdDeviceCapacityError) {
            return NextResponse.json({ error: 'Two devices are already active.', reason: 'device_limit' }, { status: 409 });
        }
        if (error instanceof Error && error.message === 'invalid device id') {
            return NextResponse.json({ error: 'Invalid device.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
    }
}
