import type { StaffRole } from '@prisma/client';

import { prisma } from '@/lib/db';
import { bedRoomIdentity, getRoomService } from '@/lib/livekit-server';

const BED_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';

export type SessionTerminationResult = {
    complete: boolean;
    stageDisconnected: number;
    bedDisconnected: number;
    failures: Array<'stage' | 'bed' | 'audit'>;
};

/**
 * Immediately remove the selected event from LiveKit after its durable status
 * has stopped new token issuance. The shared Beacon source and listeners from
 * other events are deliberately preserved.
 *
 * This operation is idempotent: an operator can repeat it after the session is
 * already ENDED/CANCELLED to catch a client that briefly reconnected with an
 * older token before observing the closing state.
 */
export async function terminateSessionMedia(input: {
    sessionId: string;
    actorUserId: string;
    actorRole: StaffRole;
}): Promise<SessionTerminationResult> {
    const session = await prisma.scheduledSession.findUnique({
        where: { id: input.sessionId },
        select: {
            roomName: true,
            participants: { select: { participantIdentity: true } },
        },
    });
    if (!session) {
        return {
            complete: false,
            stageDisconnected: 0,
            bedDisconnected: 0,
            failures: ['stage', 'bed'],
        };
    }

    const roomService = getRoomService();
    const failures: SessionTerminationResult['failures'] = [];
    const recordFailure = (failure: SessionTerminationResult['failures'][number]) => {
        if (!failures.includes(failure)) failures.push(failure);
    };
    let stageDisconnected = 0;
    let bedDisconnected = 0;

    let stageListingSucceeded = false;
    try {
        const connected = await roomService.listParticipants(session.roomName);
        stageListingSucceeded = true;
        stageDisconnected = connected.length;
    } catch {
        recordFailure('stage');
    }
    // If listing failed, still attempt the destructive LiveKit operation. In
    // an incident the inability to count must never prevent the actual cut.
    if (!stageListingSucceeded || stageDisconnected > 0) {
        try {
            await roomService.deleteRoom(session.roomName);
        } catch {
            recordFailure('stage');
            stageDisconnected = 0;
        }
    }

    const targetBedIdentities = new Set(
        session.participants.map(({ participantIdentity }) =>
            bedRoomIdentity(participantIdentity)),
    );
    let connectedTargetIdentities: string[];
    try {
        const connectedBedParticipants = await roomService.listParticipants(BED_ROOM_NAME);
        connectedTargetIdentities = connectedBedParticipants
            .map(({ identity }) => identity)
            .filter((identity) => targetBedIdentities.has(identity));
    } catch {
        // Removal is identity-scoped, so it is still safe to attempt every
        // known identity for this event. Never delete the shared bed room.
        connectedTargetIdentities = [...targetBedIdentities];
        recordFailure('bed');
    }
    try {
        const removals = await Promise.allSettled(
            connectedTargetIdentities.map((identity) =>
                roomService.removeParticipant(BED_ROOM_NAME, identity)),
        );
        bedDisconnected = removals.filter(({ status }) => status === 'fulfilled').length;
        if (removals.some(({ status }) => status === 'rejected')) recordFailure('bed');
    } catch {
        recordFailure('bed');
        bedDisconnected = 0;
    }

    try {
        await prisma.auditLog.create({
            data: {
                actorUserId: input.actorUserId,
                actorRole: input.actorRole,
                action: 'session.media_terminate',
                targetType: 'SCHEDULED_SESSION',
                targetId: input.sessionId,
                reason: 'Authorized staff terminated live event media',
                metadata: {
                    stageDisconnected,
                    bedDisconnected,
                    failures,
                },
            },
        });
    } catch {
        recordFailure('audit');
    }

    return {
        complete: failures.length === 0,
        stageDisconnected,
        bedDisconnected,
        failures,
    };
}
