import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    authorizeEarlyBirdStreamLease,
    earlyBirdOriginConfig,
    EarlyBirdAccessDeniedError,
    EarlyBirdLeaseInactiveError,
    signedEarlyBirdOriginManifestUrl,
    validSignedOriginManifest,
} from '@/lib/early-birds/stream';

export const dynamic = 'force-dynamic';

const MANIFEST_HEADERS = {
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) {
        return NextResponse.json({ error: 'Sign in required.' }, {
            status: 401,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
    const leaseId = request.nextUrl.searchParams.get('leaseId') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
        return NextResponse.json({ error: 'Invalid lease.' }, {
            status: 400,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }

    try {
        const now = new Date();
        const lease = await authorizeEarlyBirdStreamLease(session.user.id, leaseId, now);
        const config = earlyBirdOriginConfig();
        const upstreamUrl = signedEarlyBirdOriginManifestUrl({
            config,
            leaseExpiresAt: lease.expiresAt,
            now,
        });
        const upstream = await fetch(upstreamUrl, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
            headers: { accept: 'application/vnd.apple.mpegurl' },
        });
        if (!upstream.ok) throw new Error('origin manifest unavailable');
        const manifest = await upstream.text();
        if (!validSignedOriginManifest(manifest, config)) {
            throw new Error('origin manifest contract mismatch');
        }
        return new NextResponse(manifest, { status: 200, headers: MANIFEST_HEADERS });
    } catch (error) {
        if (error instanceof EarlyBirdLeaseInactiveError) {
            return NextResponse.json({ error: 'Device displaced.' }, {
                status: 410,
                headers: { 'Cache-Control': 'private, no-store' },
            });
        }
        if (error instanceof EarlyBirdAccessDeniedError) {
            return NextResponse.json({ error: 'Membership inactive.' }, {
                status: 403,
                headers: { 'Cache-Control': 'private, no-store' },
            });
        }
        // Never relay or log the signed upstream URL, secret, or response.
        return NextResponse.json({ error: 'Stream temporarily unavailable.' }, {
            status: 503,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
}
