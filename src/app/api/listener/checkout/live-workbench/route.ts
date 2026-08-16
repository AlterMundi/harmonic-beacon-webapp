import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    HttpListenerCheckoutGateway,
    ListenerCheckoutUnavailableError,
} from '@/lib/early-birds/checkout';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    LISTENER_LIVE_WORKBENCH_CSRF_HEADER,
    listenerLiveWorkbenchConfig,
    verifyListenerLiveWorkbenchCsrfToken,
} from '@/lib/early-birds/live-workbench';
import {
    LISTENER_STAGING_HOST,
    isListenerStagingHost,
} from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

const STAGING_ORIGIN = `https://${LISTENER_STAGING_HOST}`;
const MAX_REQUEST_BYTES = 256;
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): NextResponse {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
}

function exactStagingRequest(request: NextRequest): boolean {
    return isListenerStagingHost(request.headers) &&
        request.headers.get('host') === LISTENER_STAGING_HOST &&
        request.headers.get('x-forwarded-proto') === 'https' &&
        request.headers.get('origin') === STAGING_ORIGIN &&
        request.headers.get('sec-fetch-site') === 'same-origin' &&
        request.headers.get('sec-fetch-mode') === 'cors' &&
        request.headers.get('sec-fetch-dest') === 'empty' &&
        request.headers.get('content-type')?.split(';', 1)[0] === 'application/json';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    // Hide the route completely on the public Listener, event vhosts, direct
    // container access and any deployment without the private gate.
    if (!earlyBirdsEnabled() || !isListenerStagingHost(request.headers)) {
        return json({ error: 'Not found.' }, 404);
    }
    const config = listenerLiveWorkbenchConfig();
    if (!config) return json({ error: 'Not found.' }, 404);
    if (!exactStagingRequest(request)) return json({ error: 'Invalid request.' }, 403);

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
        Object.keys(input).join('\0') !== 'attemptId') {
        return json({ error: 'Invalid request.' }, 400);
    }
    const attemptId = (input as Record<string, unknown>).attemptId;
    if (typeof attemptId !== 'string' || !ATTEMPT_ID.test(attemptId)) {
        return json({ error: 'Invalid request.' }, 400);
    }

    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return json({ error: 'Sign in required.' }, 401);
    if (session.user.id !== config.accountId) return json({ error: 'Not found.' }, 404);
    if (!verifyListenerLiveWorkbenchCsrfToken({
        config,
        token: request.headers.get(LISTENER_LIVE_WORKBENCH_CSRF_HEADER),
        accountId: session.user.id,
        sessionId: session.session.id,
    })) return json({ error: 'Invalid request.' }, 403);

    try {
        const result = await new HttpListenerCheckoutGateway().create({
            accountId: session.user.id,
            email: session.user.email,
            provider: config.provider,
            attemptId,
            returnUrl: `${STAGING_ORIGIN}/?checkout=returned`,
            cancelUrl: `${STAGING_ORIGIN}/?checkout=cancelled`,
            environment: 'live',
        });
        return json({ provider: result.provider, approvalUrl: result.approvalUrl }, 200);
    } catch (error) {
        if (error instanceof ListenerCheckoutUnavailableError) {
            return json({ error: 'Checkout unavailable.' }, 503);
        }
        return json({ error: 'Checkout unavailable.' }, 503);
    }
}
