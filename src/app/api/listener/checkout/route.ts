import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    HttpListenerCheckoutGateway,
    listenerCheckoutAvailability,
    ListenerCheckoutUnavailableError,
    type ListenerCheckoutProvider,
} from '@/lib/early-birds/checkout';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import { isListenerStagingHost } from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 512;

function json(body: Record<string, unknown>, status: number): NextResponse {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

function requestOrigin(request: NextRequest): string | null {
    const host = request.headers.get('host')?.trim().toLowerCase();
    const protocol = request.headers.get('x-forwarded-proto')?.trim().toLowerCase();
    if (!host || protocol !== 'https' || !isListenerStagingHost(request.headers)) return null;
    const expected = `https://${host}`;
    return request.headers.get('origin') === expected ? expected : null;
}

function providerFrom(value: unknown): ListenerCheckoutProvider | null {
    return value === 'paypal' || value === 'mercado_pago' ? value : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return json({ error: 'Checkout unavailable.' }, 404);
    const origin = requestOrigin(request);
    if (!origin) return json({ error: 'Invalid request.' }, 403);

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
        Object.keys(input).sort().join('\0') !== ['attemptId', 'provider'].join('\0')) {
        return json({ error: 'Invalid request.' }, 400);
    }
    const body = input as Record<string, unknown>;
    const provider = providerFrom(body.provider);
    const attemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
    if (!provider || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
        return json({ error: 'Invalid request.' }, 400);
    }

    const available = listenerCheckoutAvailability();
    if ((provider === 'paypal' && !available.paypal) ||
        (provider === 'mercado_pago' && !available.mercadoPago)) {
        return json({ error: 'Checkout unavailable.' }, 404);
    }
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return json({ error: 'Sign in required.' }, 401);

    try {
        const result = await new HttpListenerCheckoutGateway().create({
            accountId: session.user.id,
            email: session.user.email,
            provider,
            attemptId,
            returnUrl: `${origin}/?checkout=returned`,
            cancelUrl: `${origin}/?checkout=cancelled`,
        });
        return json({ provider: result.provider, approvalUrl: result.approvalUrl }, 200);
    } catch (error) {
        if (error instanceof ListenerCheckoutUnavailableError) {
            return json({ error: 'Checkout unavailable.' }, 503);
        }
        return json({ error: 'Checkout unavailable.' }, 503);
    }
}
