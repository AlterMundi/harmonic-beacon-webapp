import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff(
        'FACILITATOR',
        'OPERATOR',
        'ADMIN',
    );
    if (!staff) {
        return errorResponse;
    }

    const { id } = await params;
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            facilitatorId: true,
            maxPublishers: true,
            participants: {
                orderBy: [
                    { raisedAt: 'asc' },
                    { joinedAt: 'asc' },
                ],
                select: {
                    id: true,
                    participantIdentity: true,
                    joinedAt: true,
                    leftAt: true,
                    raisedAt: true,
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                    grantVersion: true,
                    grantReconcileNeeded: true,
                    staffUser: {
                        select: {
                            name: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });
    if (!scheduledSession) {
        return NextResponse.json(
            { error: 'session_not_found' },
            { status: 404 },
        );
    }
    if (
        staff.role === 'FACILITATOR' &&
        scheduledSession.facilitatorId !== staff.userId
    ) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 },
        );
    }

    let queuePosition = 0;
    const participants = scheduledSession.participants.map((participant) => {
        const canPublish =
            participant.publishGrantedAt !== null &&
            participant.publishRevokedAt === null;
        const isWaiting = participant.raisedAt !== null && !canPublish;
        if (isWaiting) {
            queuePosition += 1;
        }
        return {
            id: participant.id,
            identity: participant.participantIdentity,
            displayName: participant.staffUser?.name ?? 'Attendee',
            principalType: participant.staffUser ? 'staff' : 'attendee',
            staffRole: participant.staffUser?.role ?? null,
            joinedAt: participant.joinedAt.toISOString(),
            leftAt: participant.leftAt?.toISOString() ?? null,
            raisedAt: participant.raisedAt?.toISOString() ?? null,
            queuePosition: isWaiting ? queuePosition : null,
            canPublish,
            grantVersion: participant.grantVersion,
            reconcileNeeded: participant.grantReconcileNeeded,
        };
    });

    return NextResponse.json({
        sessionId: scheduledSession.id,
        maxPublishers: scheduledSession.maxPublishers,
        // Julián's facilitator slot is reserved even before preflight creates
        // his participant row. Exclude an active facilitator row to avoid
        // double-counting that reservation.
        activePublishers: 1 + participants.filter(
            (participant) =>
                participant.canPublish &&
                participant.staffRole !== 'FACILITATOR',
        ).length,
        participants,
    });
}
