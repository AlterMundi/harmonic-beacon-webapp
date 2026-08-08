import { NextRequest, NextResponse } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';
import {
    EarlyBirdFreeWindowCooldownError,
    EarlyBirdFreeWindowInputError,
    getEarlyBirdFreeWindow,
    selectEarlyBirdFreeWindow,
    serializeFreeWindowState,
} from '@/lib/early-birds/free-window';
import { listenerRuntimeTrustedOrigins } from '@/lib/listener/runtime-env';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

function sameOriginMutation(request: NextRequest): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    try {
        const configured = listenerRuntimeTrustedOrigins();
        const allowed = configured.length > 0 ? configured : [request.nextUrl.origin];
        return allowed.includes(origin);
    } catch {
        return false;
    }
}

async function authenticatedAccount(request: NextRequest) {
    return currentEarlyBirdSession(request.headers).catch(() => null);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const session = await authenticatedAccount(request);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: PRIVATE_HEADERS });
    }
    try {
        const { state } = await getEarlyBirdFreeWindow(session.user.id);
        return NextResponse.json({ state: serializeFreeWindowState(state) }, { headers: PRIVATE_HEADERS });
    } catch {
        return NextResponse.json({ error: 'Free listening schedule unavailable.' }, {
            status: 503,
            headers: PRIVATE_HEADERS,
        });
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    if (!sameOriginMutation(request)) {
        return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: PRIVATE_HEADERS });
    }
    const session = await authenticatedAccount(request);
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
        const selected = await selectEarlyBirdFreeWindow({
            accountId: session.user.id,
            mode: body.mode === 'now' ? 'now' : body.mode === 'custom' ? 'custom' : (() => {
                throw new EarlyBirdFreeWindowInputError('mode must be now or custom');
            })(),
            timeZone: typeof body.timeZone === 'string' ? body.timeZone : '',
            localStartMinute: typeof body.localStartMinute === 'number' ? body.localStartMinute : undefined,
            selectionRequestId: typeof body.selectionRequestId === 'string' ? body.selectionRequestId : '',
        });
        return NextResponse.json({
            state: serializeFreeWindowState(selected.state),
            replayed: selected.replayed,
        }, { headers: PRIVATE_HEADERS });
    } catch (error) {
        if (error instanceof EarlyBirdFreeWindowCooldownError) {
            return NextResponse.json({
                error: 'Free listening schedule is locked.',
                changeAllowedAt: error.changeAllowedAt.toISOString(),
            }, { status: 409, headers: PRIVATE_HEADERS });
        }
        if (error instanceof EarlyBirdFreeWindowInputError) {
            return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
        }
        return NextResponse.json({ error: 'Free listening schedule unavailable.' }, {
            status: 503,
            headers: PRIVATE_HEADERS,
        });
    }
}
