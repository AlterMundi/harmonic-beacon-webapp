import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import {
    EARLY_BIRD_AUTH_BASE_PATH,
    earlyBirdAuth,
    earlyBirdTestAuthEnabled,
} from '@/lib/early-birds/auth';
import { issueSyntheticMembership } from '@/lib/early-birds/membership';

export const dynamic = 'force-dynamic';

function notFound(): NextResponse {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

function authorizedSyntheticLogin(request: NextRequest): boolean {
    if (!earlyBirdTestAuthEnabled()) return false;
    const authorization = request.headers.get('authorization');
    const presented = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
    const expected = process.env.EARLY_BIRDS_TEST_LOGIN_SECRET ?? '';
    return timingSafeEqual(digest(presented), digest(expected));
}

function testPassword(email: string): string {
    return createHmac('sha256', process.env.EARLY_BIRDS_TEST_LOGIN_SECRET!)
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
    if (!authorizedSyntheticLogin(request)) return notFound();

    let email: string;
    let name: string;
    try {
        const body = await request.json() as { email?: unknown; name?: unknown };
        email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        name = typeof body.name === 'string' ? body.name.trim() : '';
    } catch {
        return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }
    if (!/^[a-z0-9._-]{1,80}@e2e\.invalid$/.test(email) || name.length < 1 || name.length > 80) {
        return NextResponse.json({ error: 'An e2e.invalid identity and name are required.' }, { status: 400 });
    }

    const password = testPassword(email);
    let authResponse = await authRequest(request, 'sign-up', {
        email,
        name,
        password,
        rememberMe: true,
    });
    if (!authResponse.ok) {
        authResponse = await authRequest(request, 'sign-in', {
            email,
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
    await issueSyntheticMembership(accountId);

    return NextResponse.json(
        { ok: true, landing: '/early-birds/home' },
        { headers: new Headers(authResponse.headers) },
    );
}

export async function GET(): Promise<NextResponse> {
    return notFound();
}
