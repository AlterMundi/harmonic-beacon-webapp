import type { NextRequest } from 'next/server';

import { earlyBirdAuth } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';

export const dynamic = 'force-dynamic';

function hiddenSyntheticEmailEndpoint(request: NextRequest): Response | null {
    if (!request.nextUrl.pathname.endsWith('/sign-up/email') &&
        !request.nextUrl.pathname.endsWith('/sign-in/email')) return null;
    return Response.json({ error: 'Not found.' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

export function GET(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    return earlyBirdAuth().handler(request);
}

export function POST(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const hidden = hiddenSyntheticEmailEndpoint(request);
    if (hidden) return hidden;
    return earlyBirdAuth().handler(request);
}
