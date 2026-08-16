import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import { getEarlyBirdListeningAccess } from '@/lib/early-birds/access';
import {
    HttpListenerMembershipActionsGateway,
    ListenerMembershipActionUnavailableError,
    type ListenerMembershipAction,
} from '@/lib/early-birds/membership-actions';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 256;

function json(body: Record<string, unknown>, status: number): NextResponse {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

function requestEnvironment(request: NextRequest): 'live' | 'staging' | null {
    if (request.headers.get('x-forwarded-proto')?.trim().toLowerCase() !== 'https') return null;
    if (isCanonicalListenerHost(request.headers) &&
        request.headers.get('origin') === 'https://listen.harmonicbeacon.com') return 'live';
    if (isListenerStagingHost(request.headers) &&
        request.headers.get('origin') === 'https://earlybirds-staging.harmonicbeacon.com') return 'staging';
    return null;
}

function membershipAction(input: unknown): ListenerMembershipAction | null {
    return input === 'cancel' || input === 'reactivate' ? input : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return json({ error: 'Membership unavailable.' }, 404);
    const environment = requestEnvironment(request);
    if (!environment) return json({ error: 'Invalid request.' }, 403);
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
        return json({ error: 'Invalid request.' }, 413);
    }
    const raw = await request.text().catch(() => '');
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
        return json({ error: 'Invalid request.' }, 413);
    }
    let input: unknown;
    try {
        input = JSON.parse(raw) as unknown;
    } catch {
        return json({ error: 'Invalid request.' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).sort().join('\0') !== ['action', 'attemptId'].join('\0')) {
        return json({ error: 'Invalid request.' }, 400);
    }
    const attemptId = (input as Record<string, unknown>).attemptId;
    const action = membershipAction((input as Record<string, unknown>).action);
    if (typeof attemptId !== 'string' || !action ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
        return json({ error: 'Invalid request.' }, 400);
    }
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return json({ error: 'Sign in required.' }, 401);

    let provider: 'paypal' | 'mercado_pago' | null = null;
    if (environment === 'staging') {
        const access = await getEarlyBirdListeningAccess(session.user.id).catch(() => null);
        provider = access?.membership.projection?.source === 'PAYPAL'
            ? 'paypal'
            : access?.membership.projection?.source === 'MERCADO_PAGO'
                ? 'mercado_pago'
                : null;
        if (!provider) return json({ error: 'Membership unavailable.' }, 422);
    }

    try {
        await new HttpListenerMembershipActionsGateway().requestAction({
            accountId: session.user.id,
            attemptId,
            action,
            environment,
            provider,
        });
        return json({ status: 'queued' }, 202);
    } catch (error) {
        if (error instanceof ListenerMembershipActionUnavailableError) {
            return json({ error: 'Membership unavailable.' }, 503);
        }
        return json({ error: 'Membership unavailable.' }, 503);
    }
}
