import { NextRequest, NextResponse } from 'next/server';
import { trustedLiveRequestOrigin } from '@/lib/account-rp';
import { recordCohortVisit } from '@/lib/cohort-visits';
import { accountIdentityFromToken } from '@/lib/principal';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function response(body: unknown, status: number) {
    return NextResponse.json(body, { status, headers });
}

export async function POST(request: NextRequest) {
    let origin: string;
    try { origin = trustedLiveRequestOrigin(request); }
    catch { return response({ error: 'Not found' }, 404); }
    if (request.headers.get('origin') !== origin ||
        request.headers.get('sec-fetch-site') !== 'same-origin') {
        return response({ error: 'Forbidden' }, 403);
    }
    let surface: 'landing' | 'session';
    try {
        const raw = await request.text();
        if (raw.length > 128) return response({ error: 'Invalid observation' }, 400);
        const body = JSON.parse(raw);
        if (!body || Object.keys(body).length !== 1 ||
            !['landing', 'session'].includes(body.surface)) {
            return response({ error: 'Invalid observation' }, 400);
        }
        surface = body.surface;
    } catch { return response({ error: 'Invalid observation' }, 400); }
    try {
        const account = await accountIdentityFromToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
        if (!account) return response({ error: 'Authentication required' }, 401);
        const observed = await recordCohortVisit(account, surface);
        return response({ accepted: true, observed }, 202);
    } catch {
        // Observation failure is contained; never print cookies or profiles.
        return response({ error: 'Observation unavailable' }, 503);
    }
}
