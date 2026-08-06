import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    EarlyBirdAccessDeniedError,
    EarlyBirdLeaseInactiveError,
    heartbeatEarlyBirdStreamLease,
} from '@/lib/early-birds/stream';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    let leaseId: string;
    try {
        const body = await request.json() as { leaseId?: unknown };
        leaseId = typeof body.leaseId === 'string' ? body.leaseId : '';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
        return NextResponse.json({ error: 'Invalid lease.' }, { status: 400 });
    }

    try {
        const grant = await heartbeatEarlyBirdStreamLease(session.user.id, leaseId);
        return NextResponse.json({
            leaseExpiresAt: grant.leaseExpiresAt.toISOString(),
            stream: {
                manifestUrl: grant.stream.manifestUrl,
                expiresAt: grant.stream.expiresAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof EarlyBirdLeaseInactiveError) {
            return NextResponse.json({ error: 'Device displaced.' }, { status: 410 });
        }
        if (error instanceof EarlyBirdAccessDeniedError) {
            return NextResponse.json({ error: 'Membership inactive.' }, { status: 403 });
        }
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
    }
}
