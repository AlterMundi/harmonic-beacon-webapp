import { NextResponse } from 'next/server';
import { TrackSource } from 'livekit-server-sdk';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';

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
            roomName: true,
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

    let liveStateAvailable = true;
    let liveParticipants = new Map<string, {
        media: Array<{ trackSid: string; source: string; muted: boolean }>;
    }>();
    try {
        liveParticipants = new Map(
            (await getRoomService().listParticipants(scheduledSession.roomName))
                .map((participant) => [
                    participant.identity,
                    {
                        media: participant.tracks.map((track) => ({
                            trackSid: track.sid,
                            source: trackSourceLabel(track.source),
                            muted: track.muted,
                        })),
                    },
                ]),
        );
    } catch {
        // Durable grants and the queue remain usable during a LiveKit API
        // outage. The console marks live fields unknown and keeps polling.
        liveStateAvailable = false;
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
        const live = liveParticipants.get(participant.participantIdentity);
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
            connected: liveStateAvailable ? Boolean(live) : null,
            media: live?.media ?? [],
            // RoomService's ParticipantInfo does not expose connection quality.
            // Keep the field explicit so the UI never invents a value.
            connectionQuality: null,
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
        liveStateAvailable,
        participants,
    });
}

function trackSourceLabel(source: TrackSource): string {
    switch (source) {
        case TrackSource.CAMERA:
            return 'CAMERA';
        case TrackSource.MICROPHONE:
            return 'MICROPHONE';
        case TrackSource.SCREEN_SHARE:
            return 'SCREEN_SHARE';
        case TrackSource.SCREEN_SHARE_AUDIO:
            return 'SCREEN_SHARE_AUDIO';
        default:
            return 'UNKNOWN';
    }
}
