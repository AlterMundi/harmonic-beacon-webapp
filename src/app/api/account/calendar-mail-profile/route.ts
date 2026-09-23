import { timingSafeEqual } from 'node:crypto';

import { accountAuthorityDatabaseReady } from '@/lib/account/authority-db';
import { accountRateSecret, isAccountHost } from '@/lib/account/config';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';
import { prisma } from '@/lib/db';

function response(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

/** Dedicated read-only service credential. Not an OAuth client or user grant. */
export async function POST(request: Request): Promise<Response> {
    if (process.env.BEACON_ACCOUNT_CALENDAR_MAIL_ENABLED !== '1' ||
        !isAccountHost(request.headers.get('host') ?? new URL(request.url).host) ||
        !await accountAuthorityDatabaseReady()) return response({ error: 'not_found' }, 404);
    const secret = process.env.BEACON_ACCOUNT_CALENDAR_MAIL_SERVICE_SECRET;
    if (!secret || secret.length < 32) return response({ error: 'unavailable' }, 503);
    const expected = Buffer.from(`Basic ${Buffer.from(`pmp-calendar-mail:${secret}`).toString('base64')}`);
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return response({ error: 'unauthorized' }, 401);
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        return response({ error: 'invalid_request' }, 415);
    }
    // Never echo account IDs, mailbox values or credentials in errors.
    const reader = request.body?.getReader();
    let raw = '';
    if (reader) {
        const decoder = new TextDecoder();
        let size = 0;
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 2048) {
                await reader.cancel();
                return response({ error: 'invalid_request' }, 413);
            }
            raw += decoder.decode(part.value, { stream: true });
        }
        raw += decoder.decode();
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return response({ error: 'invalid_request' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !('sub' in body) ||
        typeof body.sub !== 'string' || !body.sub || body.sub.length > 256) {
        return response({ error: 'invalid_request' }, 400);
    }
    const rateSecret = accountRateSecret();
    if (!rateSecret || !await consumeAccountRateLimit({
        request, email: body.sub, purpose: 'calendar-mail-profile', secret: rateSecret,
        maxPerEmail: 100, maxGlobal: 100_000, includeOriginBucket: false,
    })) return response({ error: 'rate_limited' }, 429);
    const account = await prisma.earlyBirdUser.findUnique({
        where: { id: body.sub }, select: { id: true, email: true },
    });
    if (!account || account.email.endsWith('@identity.invalid')) {
        return response({ error: 'not_found' }, 404);
    }
    return response({ sub: account.id, email: account.email });
}
