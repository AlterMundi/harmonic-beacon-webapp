import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import {
    EARLY_BIRD_AUTH_BASE_PATH,
    earlyBirdAuth,
    earlyBirdTestAuthEnabled,
    earlyBirdTestLoginSecret,
} from '@/lib/early-birds/auth';
import { issueSyntheticMembership } from '@/lib/early-birds/membership';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';

export const dynamic = 'force-dynamic';

function notFound(): NextResponse {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

function authorizedSyntheticLogin(request: NextRequest): boolean {
    const expected = earlyBirdTestLoginSecret();
    if (!expected || !earlyBirdTestAuthEnabled()) return false;
    const authorization = request.headers.get('authorization');
    const presented = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
    return timingSafeEqual(digest(presented), digest(expected));
}

function testPassword(email: string): string {
    const secret = earlyBirdTestLoginSecret();
    if (!secret) throw new Error('Listener synthetic login is not configured');
    return createHmac('sha256', secret)
        .update(`early-birds-test-login:v1:${email}`)
        .digest('base64url');
}

async function authRequest(
    request: NextRequest,
    operation: 'sign-up' | 'sign-in',
    body: Record<string, unknown>,
): Promise<Response> {
    const url = new URL(`${EARLY_BIRD_AUTH_BASE_PATH}/${operation}/email`, request.url);
    const headers = new Headers(request.headers);
    // The test harness credential authorizes this route only. It is not part
    // of Better Auth's request and never enters a cookie or client response.
    headers.delete('authorization');
    headers.set('content-type', 'application/json');
    return earlyBirdAuth().handler(new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled() || !syntheticTeamEntryAllowed({
        headers: request.headers,
        requestProtocol: request.nextUrl.protocol,
    })) return notFound();
    if (!authorizedSyntheticLogin(request)) return notFound();

    let email: string;
    let name: string;
    let authOnly: boolean;
    try {
        const body = await request.json() as { email?: unknown; name?: unknown; authOnly?: unknown };
        email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        name = typeof body.name === 'string' ? body.name.trim() : '';
        authOnly = body.authOnly === true;
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (!/^[a-z0-9._-]{1,80}@e2e\.invalid$/.test(email) || name.length < 1 || name.length > 80) {
        return NextResponse.json({ error: 'An e2e.invalid identity and name are required.' }, { status: 400 });
    }

    const password = testPassword(email);
    // Returning testers are the common case during multi-device acceptance.
    // Sign in first so an existing account does not spend a sign-up rate-limit
    // attempt before every device login. A new synthetic identity falls back
    // to the one bounded sign-up request.
    let authResponse = await authRequest(request, 'sign-in', {
        email,
        password,
        rememberMe: true,
    });
    if (!authResponse.ok) {
        authResponse = await authRequest(request, 'sign-up', {
            email,
            name,
            password,
            rememberMe: true,
        });
    }
    if (!authResponse.ok) {
        return NextResponse.json({ error: 'Synthetic login failed.' }, { status: 503 });
    }

    const payload = await authResponse.clone().json() as { user?: { id?: unknown } };
    const accountId = typeof payload.user?.id === 'string' ? payload.user.id : null;
    if (!accountId) return NextResponse.json({ error: 'Synthetic login failed.' }, { status: 503 });
    // Invitation acceptance uses this seam only for its staging identity. The
    // canonical authority remains the sole issuer of the Free membership.
    if (!authOnly) await issueSyntheticMembership(accountId);

    return NextResponse.json(
        { ok: true, landing: '/early-birds' },
        { headers: new Headers(authResponse.headers) },
    );
}

export async function GET(): Promise<NextResponse> {
    return notFound();
}
