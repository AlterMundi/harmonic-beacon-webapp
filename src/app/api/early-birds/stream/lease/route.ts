import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';
import {
    acquireEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdDeviceCapacityError,
    EarlyBirdStreamIssuerUnavailableError,
    prepareEarlyBirdStreamLease,
} from '@/lib/early-birds/stream';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();

    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    let deviceId: string;
    let intent: 'play' | 'prepare';
    try {
        const body = await request.json() as { deviceId?: unknown; intent?: unknown };
        deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
        intent = body.intent === 'prepare' ? 'prepare' : 'play';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    try {
        const grant = intent === 'prepare'
            ? await prepareEarlyBirdStreamLease(session.user.id, deviceId)
            : await acquireEarlyBirdStreamLease(session.user.id, deviceId);
        return NextResponse.json({
            leaseId: grant.leaseId,
            leaseExpiresAt: grant.leaseExpiresAt.toISOString(),
            evictedAnotherDevice: grant.evictedLeaseId !== null,
            stream: {
                manifestUrl: grant.stream.manifestUrl,
                expiresAt: grant.stream.expiresAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof EarlyBirdAccessDeniedError) {
            return NextResponse.json({ error: 'Membership inactive.' }, { status: 403 });
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
