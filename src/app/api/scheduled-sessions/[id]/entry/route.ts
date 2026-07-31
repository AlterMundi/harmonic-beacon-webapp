import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { principalFromToken } from '@/lib/principal';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

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
    const principal = await principalFromToken(
        request.cookies.get(SESSION_COOKIE_NAME)?.value,
    );
    if (!principal) {
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
        },
    });
    if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (principal.kind === 'attendee' && principal.scheduledSessionId !== session.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (principal.kind === 'staff') {
        const assignedFacilitator =
            principal.role === 'FACILITATOR' && session.facilitatorId === principal.userId;
        const operations = principal.role === 'OPERATOR' || principal.role === 'ADMIN';
        if (!assignedFacilitator && !operations) {
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
