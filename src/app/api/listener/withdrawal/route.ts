import { NextResponse, type NextRequest } from 'next/server';

import {
    ListenerWithdrawalConflictError,
    ListenerWithdrawalInputError,
    ListenerWithdrawalRateLimitError,
    listenerWithdrawalNetworkIdentity,
    listenerWithdrawalPublicConfiguration,
    parseListenerWithdrawalInput,
    submitListenerWithdrawal,
} from '@/lib/listener/consumer-withdrawal';
import { LISTENER_WITHDRAWAL_MAX_REQUEST_BYTES } from '@/lib/listener/consumer-withdrawal-contract';
import {
    isCanonicalListenerHost,
    isListenerStagingHost,
} from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

function json(body: Record<string, unknown>, status: number, retryAfter?: number): NextResponse {
    const response = NextResponse.json(body, { status });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (retryAfter) response.headers.set('Retry-After', String(retryAfter));
    return response;
}

function trustedRequest(request: NextRequest): boolean {
    if (!isCanonicalListenerHost(request.headers) && !isListenerStagingHost(request.headers)) return false;
    const host = request.headers.get('host')?.trim().toLowerCase();
    const protocol = request.headers.get('x-forwarded-proto')?.trim().toLowerCase();
    if (!host || protocol !== 'https' || request.headers.get('origin') !== `https://${host}`) return false;
    return request.headers.get('x-listener-withdrawal-intent') === '1'
        && request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const configuration = listenerWithdrawalPublicConfiguration();
    if (!configuration) return json({ error: 'Not found.' }, 404);
    if (!trustedRequest(request)) return json({ error: 'Invalid request.' }, 403);

    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LISTENER_WITHDRAWAL_MAX_REQUEST_BYTES)) {
        return json({ error: 'Invalid request.' }, 413);
    }
    const raw = await request.text().catch(() => '');
    if (new TextEncoder().encode(raw).byteLength > LISTENER_WITHDRAWAL_MAX_REQUEST_BYTES) {
        return json({ error: 'Invalid request.' }, 413);
    }

    try {
        const body = JSON.parse(raw) as unknown;
        const parsed = parseListenerWithdrawalInput(body);
        const result = await submitListenerWithdrawal({
            request: parsed,
            networkIdentity: listenerWithdrawalNetworkIdentity(request),
            secret: configuration.secret!,
        });
        return json({
            receiptCode: result.receiptCode,
            receivedAt: result.receivedAt.toISOString(),
        }, 201);
    } catch (error) {
        if (error instanceof ListenerWithdrawalInputError) {
            return json({ error: 'Invalid request.' }, 400);
        }
        if (error instanceof ListenerWithdrawalConflictError) {
            return json({ error: 'Invalid request.' }, 409);
        }
        if (error instanceof ListenerWithdrawalRateLimitError) {
            return json({ error: 'Please try again later.' }, 429, 3_600);
        }
        return json({ error: 'Request service unavailable.' }, 503);
    }
}
