import { NextRequest, NextResponse } from 'next/server';

import { getEarlyBirdListeningAccess } from '@/lib/early-birds/access';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import {
    EarlyBirdWelcomeAccessInputError,
    EarlyBirdWelcomeAccessUnavailableError,
    serializeWelcomeAccessState,
    startEarlyBirdWelcomeAccess,
} from '@/lib/early-birds/welcome-access';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

function sameOriginMutation(request: NextRequest): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    const configured = [
        process.env.EARLY_BIRDS_AUTH_BASE_URL,
        ...(process.env.EARLY_BIRDS_TRUSTED_ORIGINS ?? '').split(','),
    ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));
    const allowed = configured.length > 0 ? configured : [request.nextUrl.origin];
    return allowed.includes(origin);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: PRIVATE_HEADERS });
    }
    try {
        const access = await getEarlyBirdListeningAccess(session.user.id);
        return NextResponse.json({
            state: serializeWelcomeAccessState(access.welcome),
            serverNow: new Date().toISOString(),
        }, { headers: PRIVATE_HEADERS });
    } catch {
        return NextResponse.json({ error: 'Welcome access unavailable.' }, {
            status: 503,
            headers: PRIVATE_HEADERS,
        });
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    if (earlyBirdsFreeForAll()) {
        return NextResponse.json({ error: 'Public access is already active.' }, {
            status: 409,
            headers: PRIVATE_HEADERS,
        });
    }
    if (!sameOriginMutation(request)) {
        return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: PRIVATE_HEADERS });
    }
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: PRIVATE_HEADERS });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    try {
        const result = await startEarlyBirdWelcomeAccess({
            accountId: session.user.id,
            activationRequestId: typeof body.activationRequestId === 'string'
                ? body.activationRequestId
                : '',
        });
        return NextResponse.json({
            state: serializeWelcomeAccessState(result.state),
            replayed: result.replayed,
        }, { headers: PRIVATE_HEADERS });
    } catch (error) {
        if (error instanceof EarlyBirdWelcomeAccessInputError) {
            return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
        }
        if (error instanceof EarlyBirdWelcomeAccessUnavailableError) {
            return NextResponse.json({ error: 'Welcome access is no longer available.' }, {
                status: 409,
                headers: PRIVATE_HEADERS,
            });
        }
        return NextResponse.json({ error: 'Welcome access unavailable.' }, {
            status: 503,
            headers: PRIVATE_HEADERS,
        });
    }
}
