import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { accountIdentityFromToken, principalFromToken } from '@/lib/principal';
import { attachPublicSessionAccess } from '@/lib/public-session-access';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

/**
 * Lightweight, non-token entry state. The room page polls this before mounting
 * either LiveKit connection, so a valid ticket can wait truthfully without
 * receiving stage or bed credentials.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    let principal = await principalFromToken(cookieValue);
    const account = principal ? null : await accountIdentityFromToken(cookieValue);
    if (!principal && !account) {
        return NextResponse.json(
            { error: 'Authentication required' },
            { status: 401 },
        );
    }

    const { id } = await params;
    const session = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            title: true,
            language: true,
            scheduledAt: true,
            status: true,
            facilitatorId: true,
            publicAccess: true,
        },
    });
    if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (!principal && account && cookieValue && session.publicAccess) {
        const attached = await attachPublicSessionAccess(cookieValue, session, account);
        if (attached) principal = await principalFromToken(cookieValue);
    }
    if (!principal) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (principal.kind === 'attendee' && principal.scheduledSessionId !== session.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (principal.kind === 'staff') {
        const policy = eventStaffPolicy(
            principal.role,
            session.facilitatorId === principal.userId,
        );
        if (!policy.canOperateEvent) {
            return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }
    }

    const state = session.status === 'SCHEDULED'
        ? (principal.kind === 'attendee' ? 'WAITING' : 'READY')
        : session.status === 'LIVE'
            ? 'READY'
            : session.status;

    return NextResponse.json({
        state,
        session: {
            id: session.id,
            title: session.title,
            language: session.language,
            scheduledAt: session.scheduledAt.toISOString(),
            status: session.status,
        },
    });
}
