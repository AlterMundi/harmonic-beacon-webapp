import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    acquireEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdStreamIssuerUnavailableError,
} from '@/lib/early-birds/stream';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    let deviceId: string;
    try {
        const body = await request.json() as { deviceId?: unknown };
        deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    try {
        const grant = await acquireEarlyBirdStreamLease(session.user.id, deviceId);
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
        if (error instanceof Error && error.message === 'invalid device id') {
            return NextResponse.json({ error: 'Invalid device.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
    }
}
