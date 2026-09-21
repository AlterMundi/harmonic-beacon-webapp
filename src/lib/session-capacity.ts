import type { StaffRole } from '@prisma/client';

import { prisma } from '@/lib/db';
import { isSceneCapacity, type SceneCapacity } from '@/lib/scene-capacity';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { lockGrantSession } from '@/lib/stage-grant-locks';

export type SessionCapacityErrorCode =
    | 'invalid_capacity'
    | 'session_not_found'
    | 'forbidden'
    | 'capacity_below_active_grants';

export class SessionCapacityError extends Error {
    constructor(
        public readonly code: SessionCapacityErrorCode,
        public readonly status: number,
        message: string,
        public readonly details: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = 'SessionCapacityError';
    }
}

type SetSessionSceneCapacityInput = {
    scheduledSessionId: string;
    actorUserId: string;
    actorRole: StaffRole;
    maxPublishers: unknown;
    reason?: string | null;
    now?: Date;
};

export async function setSessionSceneCapacity(input: SetSessionSceneCapacityInput) {
    if (!isSceneCapacity(input.maxPublishers)) {
        throw new SessionCapacityError(
            'invalid_capacity',
            400,
            'Scene capacity must be 6, 9, or 12',
        );
    }
    const maxPublishers: SceneCapacity = input.maxPublishers;
    const changedAt = input.now ?? new Date();

    return prisma.$transaction(async (tx) => {
        // Promotions use this same session-row lock, so capacity checks and
        // publisher grants are serialized in one canonical order.
        await lockGrantSession(tx, input.scheduledSessionId);
        const session = await tx.scheduledSession.findUnique({
            where: { id: input.scheduledSessionId },
            select: { id: true, facilitatorId: true, maxPublishers: true },
        });
        if (!session) {
            throw new SessionCapacityError('session_not_found', 404, 'Session not found');
        }

        if (!hasStaffCapability(input.actorRole, 'administer_system')) {
            throw new SessionCapacityError('forbidden', 403, 'Insufficient permissions');
        }

        const activePublisherGrants = await tx.sessionParticipant.count({
            where: {
                scheduledSessionId: input.scheduledSessionId,
                publishGrantedAt: { not: null },
                publishRevokedAt: null,
            },
        });
        if (maxPublishers < activePublisherGrants) {
            throw new SessionCapacityError(
                'capacity_below_active_grants',
                409,
                'Capacity cannot be lower than active publisher grants',
                { activePublisherGrants, requestedMaxPublishers: maxPublishers },
            );
        }

        if (session.maxPublishers !== maxPublishers) {
            await tx.scheduledSession.update({
                where: { id: input.scheduledSessionId },
                data: { maxPublishers },
                select: { maxPublishers: true },
            });
            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actorRole: input.actorRole,
                    action: 'session.scene_capacity.change',
                    targetType: 'SCHEDULED_SESSION',
                    targetId: input.scheduledSessionId,
                    reason: input.reason?.trim() || null,
                    metadata: {
                        previousMaxPublishers: session.maxPublishers,
                        maxPublishers,
                        activePublisherGrants,
                    },
                    createdAt: changedAt,
                },
            });
        }

        return {
            scheduledSessionId: input.scheduledSessionId,
            previousMaxPublishers: session.maxPublishers,
            maxPublishers,
            activePublisherGrants,
            changedAt,
        };
    });
}
