import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsFreeForAll,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import {
    authorizeEarlyBirdStreamLease,
    authorizeFreeForAllStreamLease,
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
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();

    const freeForAll = earlyBirdsFreeForAll();
    const session = freeForAll
        ? null
        : await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!freeForAll && !session) {
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
        const lease = freeForAll
            ? await authorizeFreeForAllStreamLease(leaseId, now)
            : await authorizeEarlyBirdStreamLease(session!.user.id, leaseId, now);
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
            const reason = error.reason === 'evicted'
                ? 'displaced'
                : error.reason === 'expired' ? 'expired' : 'inactive';
            return NextResponse.json({
                error: reason === 'displaced'
                    ? 'Device displaced.'
                    : reason === 'expired' ? 'Listening lease expired.' : 'Listening lease inactive.',
                reason,
            }, {
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
