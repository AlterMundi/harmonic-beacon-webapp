import { NextResponse, type NextRequest } from 'next/server';

import { clientAddress } from '@/lib/client-address';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import {
    EarlyBirdAccessDeniedError,
    EarlyBirdLeaseInactiveError,
    EarlyBirdLeaseRefreshRequiredError,
    heartbeatFreeForAllStreamLease,
    heartbeatEarlyBirdStreamLease,
} from '@/lib/early-birds/stream';
import { resolveListenerMacroRegion } from '@/lib/listener/presence';

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
    let leaseGeneration: number;
    let presenceSequence: number;
    let intent: 'play' | 'prepare';
    let presence: 'IDLE' | 'LISTENING';
    try {
        const body = await request.json() as {
            leaseId?: unknown;
            intent?: unknown;
            presence?: unknown;
            leaseGeneration?: unknown;
            presenceSequence?: unknown;
        };
        leaseId = typeof body.leaseId === 'string' ? body.leaseId : '';
        leaseGeneration = typeof body.leaseGeneration === 'number' ? body.leaseGeneration : 0;
        presenceSequence = typeof body.presenceSequence === 'number' ? body.presenceSequence : -1;
        intent = body.intent === 'prepare' ? 'prepare' : 'play';
        if (body.presence !== 'idle' && body.presence !== 'listening') {
            return NextResponse.json({ error: 'Invalid presence.' }, { status: 400 });
        }
        presence = body.presence === 'idle' ? 'IDLE' : 'LISTENING';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
        return NextResponse.json({ error: 'Invalid lease.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(leaseGeneration) || leaseGeneration < 1
        || !Number.isSafeInteger(presenceSequence) || presenceSequence < 0) {
        return NextResponse.json({
            error: 'Lease refresh required.',
            reason: 'refresh_required',
        }, { status: 409 });
    }

    try {
        const macroRegion = await resolveListenerMacroRegion(clientAddress(request.headers));
        const reportedPresence = { state: presence, macroRegion } as const;
        const grant = freeForAll
            ? await heartbeatFreeForAllStreamLease(
                leaseId,
                leaseGeneration,
                presenceSequence,
                undefined,
                undefined,
                reportedPresence,
            )
            : await heartbeatEarlyBirdStreamLease(
                session!.user.id,
                leaseId,
                leaseGeneration,
                presenceSequence,
                undefined,
                undefined,
                intent === 'play',
                reportedPresence,
            );
        return NextResponse.json({
            serverNow: grant.serverNow.toISOString(),
            accessKind: grant.accessKind,
            quota: grant.quota,
            leaseGeneration: grant.leaseGeneration,
            presenceSequence: grant.presenceSequence,
            leaseExpiresAt: grant.leaseExpiresAt.toISOString(),
            stream: {
                manifestUrl: grant.stream.manifestUrl,
                expiresAt: grant.stream.expiresAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof EarlyBirdLeaseRefreshRequiredError) {
            return NextResponse.json({
                error: 'Lease refresh required.',
                reason: 'refresh_required',
            }, { status: 409 });
        }
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
            return NextResponse.json({ error: 'Listening access inactive.' }, { status: 403 });
        }
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, { status: 503 });
    }
}
