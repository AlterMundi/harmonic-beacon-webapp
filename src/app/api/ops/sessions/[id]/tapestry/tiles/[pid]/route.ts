import { NextRequest, NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { tapestryInternalUrl } from '@/lib/tapestry';

export const dynamic = 'force-dynamic';

/**
 * Single tapestry tile proxy for the ops arrange UI. Staff-only, never
 * cached: tiles are live participant snapshots.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; pid: string }> },
) {
    const [staff, errorResponse] = await requireStaff(
        'FACILITATOR',
        'OPERATOR',
        'ADMIN',
    );
    if (!staff) {
        return errorResponse;
    }
    const { id, pid } = await params;
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl) {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/frame.jpg`,
            {
                headers: { 'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET! },
                cache: 'no-store',
                signal: AbortSignal.timeout(3_000),
            },
        );
        if (!response.ok) {
            return NextResponse.json({ error: 'Tapestry unavailable' }, { status: response.status === 404 ? 404 : 502 });
        }
        return new NextResponse(await response.arrayBuffer(), {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' },
        });
    } catch {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }
}
