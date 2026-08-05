import { NextRequest, NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { publicTapestryEnabled, tapestryInternalUrl } from '@/lib/tapestry';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

const PUBLIC_CACHE_HEADERS = {
    'cache-control': 'public, max-age=0, s-maxage=2, stale-while-revalidate=1',
    'cdn-cache-control': 'public, max-age=2',
    'content-type': 'image/jpeg',
};
const STAFF_CACHE_HEADERS = { 'cache-control': 'private, no-store', 'content-type': 'image/jpeg' };

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await params;
    const isPublic = publicTapestryEnabled();

    if (!isPublic) {
        const [staff, errorResponse] = await requireStaff();
        if (!staff) return errorResponse;
        const session = await prisma.scheduledSession.findUnique({
            where: { id: sessionId },
            select: { facilitatorId: true },
        });
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        if (!eventStaffPolicy(
            staff.role,
            session.facilitatorId === staff.userId,
        ).canOperateEvent) {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }
    } else {
        // A public composite has no cookie-dependent authorization or Vary header,
        // otherwise a shared edge cache could leak an authenticated response.
        const session = await prisma.scheduledSession.findUnique({ where: { id: sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const internalUrl = tapestryInternalUrl();
    if (!internalUrl) return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });

    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}/composite.jpg`,
            {
                headers: { 'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET! },
                cache: 'no-store',
                signal: AbortSignal.timeout(3_000),
            },
        );
        if (!response.ok) {
            return NextResponse.json({ error: 'Tapestry unavailable' }, { status: response.status === 404 ? 404 : 502 });
        }
        // The revision header names the exact build these bytes came from;
        // overlay consumers (raised-hand names) only draw when it matches
        // the layout revision. It is an opaque build counter, not metadata.
        const revision = response.headers.get('x-tapestry-revision');
        return new NextResponse(await response.arrayBuffer(), {
            status: 200,
            headers: {
                ...(isPublic ? PUBLIC_CACHE_HEADERS : STAFF_CACHE_HEADERS),
                ...(revision ? { 'x-tapestry-revision': revision } : {}),
            },
        });
    } catch {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }
}
