import { NextRequest, NextResponse } from 'next/server';

import { resolveRoomPrincipal } from '@/lib/room-entitlement';
import { tapestryInternalUrl, tapestryParticipantId } from '@/lib/tapestry';

export const dynamic = 'force-dynamic';

const MAX_FRAME_BYTES = 20 * 1024;

/**
 * Entitlement-gated JPEG relay. Browser identity is resolved from its opaque
 * session cookie; only a separately-derived tapestry key reaches the service.
 */
export async function POST(request: NextRequest) {
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
    if (!sessionId) {
        return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (request.headers.get('content-type') !== 'image/jpeg') {
        return NextResponse.json({ error: 'JPEG required' }, { status: 415 });
    }
    const length = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAX_FRAME_BYTES) {
        return NextResponse.json({ error: 'Frame too large' }, { status: 413 });
    }

    const entitlement = await resolveRoomPrincipal(request, sessionId);
    if (!entitlement.ok) {
        return NextResponse.json({ error: entitlement.error }, { status: entitlement.status });
    }

    const internalUrl = tapestryInternalUrl();
    if (!internalUrl) {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }

    const frame = await request.arrayBuffer();
    if (frame.byteLength === 0 || frame.byteLength > MAX_FRAME_BYTES) {
        return NextResponse.json({ error: frame.byteLength ? 'Frame too large' : 'JPEG required' }, { status: frame.byteLength ? 413 : 400 });
    }

    try {
        const contributorId = tapestryParticipantId(entitlement.principal.identity);
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}/participants/${contributorId}/frame`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'image/jpeg',
                    'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET!,
                },
                body: frame,
                cache: 'no-store',
                signal: AbortSignal.timeout(3_000),
            },
        );
        return new NextResponse(null, {
            status: response.ok ? 204 : response.status === 429 ? 429 : 502,
            headers: { 'cache-control': 'no-store' },
        });
    } catch {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }
}
