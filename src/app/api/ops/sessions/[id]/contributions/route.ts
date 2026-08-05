import { NextRequest, NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
    ContributionError,
    decodeContributionCursor,
    listStaffContributions,
    parseContributionsPageLimit,
} from '@/lib/session-contributions';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

/**
 * CHAT-01 (#137): the staff reading of the questions-and-emotions feed.
 * Authorized staff see the real author of every contribution plus an explicit
 * flag for how the audience sees it — an ANONYMOUS message is anonymous to
 * the audience only, never to event staff. Moderation transitions (hide,
 * restore, withdraw) are CHAT-02; this route is read-only.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) {
        return errorResponse;
    }

    const { id } = await params;
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: { id: true, facilitatorId: true },
    });
    if (!scheduledSession) {
        return NextResponse.json(
            { error: 'session_not_found' },
            { status: 404 },
        );
    }
    if (!eventStaffPolicy(
        staff.role,
        scheduledSession.facilitatorId === staff.userId,
    ).canOperateEvent) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 },
        );
    }

    try {
        const searchParams = request.nextUrl.searchParams;
        const page = await listStaffContributions({
            scheduledSessionId: scheduledSession.id,
            cursor: decodeContributionCursor(searchParams.get('cursor')),
            limit: parseContributionsPageLimit(searchParams.get('limit')),
        });
        return NextResponse.json(page, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (failure) {
        if (failure instanceof ContributionError) {
            return NextResponse.json(
                { error: failure.code, message: failure.message, ...failure.details },
                { status: failure.status },
            );
        }
        console.error('[contributions] unexpected staff feed failure');
        return NextResponse.json(
            { error: 'contributions_unavailable' },
            { status: 500 },
        );
    }
}
