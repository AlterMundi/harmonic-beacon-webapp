import { Prisma, type ScheduledSessionStatus } from '@prisma/client';

import { prisma } from '@/lib/db';

export const SESSION_OPEN_EARLY_MS = 10 * 60 * 1000;
export const SESSION_OPEN_LATE_MS = 60 * 60 * 1000;

export type LifecycleTargetStatus = Extract<
    ScheduledSessionStatus,
    'LIVE' | 'ENDED' | 'CANCELLED'
>;

type LifecycleActor = {
    id: string;
    role: string;
};

type TransitionableSession = {
    id: string;
    status: ScheduledSessionStatus;
    scheduledAt: Date;
    facilitatorId: string;
};

export class SessionLifecycleError extends Error {
    constructor(
        public readonly status: 400 | 403 | 404 | 409,
        public readonly code:
            | 'forbidden'
            | 'not_found'
            | 'invalid_transition'
            | 'reason_required'
            | 'outside_open_window',
        message: string,
    ) {
        super(message);
        this.name = 'SessionLifecycleError';
    }
}

export type TransitionDecision =
    | { kind: 'idempotent' }
    | { kind: 'transition'; adminOverride: boolean; auditReason: string };

/**
 * The single lifecycle policy. Routes and future cockpit controls must call
 * this instead of growing their own status comparisons.
 */
export function decideSessionTransition(input: {
    session: TransitionableSession;
    actor: LifecycleActor;
    targetStatus: LifecycleTargetStatus;
    reason?: string;
    now: Date;
}): TransitionDecision {
    const { session, actor, targetStatus, now } = input;
    const reason = input.reason?.trim() || '';
    const globallyAuthorized = actor.role === 'OPERATOR' || actor.role === 'ADMIN';
    const assignedFacilitator =
        actor.role === 'FACILITATOR' && session.facilitatorId === actor.id;

    if (!globallyAuthorized && !assignedFacilitator) {
        throw new SessionLifecycleError(
            403,
            'forbidden',
            'You are not authorized to operate this event',
        );
    }

    // Cancellation is an administrative action even when a repeated request
    // has nothing left to mutate.
    if (targetStatus === 'CANCELLED' && actor.role !== 'ADMIN') {
        throw new SessionLifecycleError(
            403,
            'forbidden',
            'Only an administrator may cancel an event',
        );
    }

    if (session.status === targetStatus) return { kind: 'idempotent' };

    const legal =
        (session.status === 'SCHEDULED' && targetStatus === 'LIVE') ||
        (session.status === 'LIVE' && targetStatus === 'ENDED') ||
        ((session.status === 'SCHEDULED' || session.status === 'LIVE') &&
            targetStatus === 'CANCELLED');
    if (!legal) {
        throw new SessionLifecycleError(
            409,
            'invalid_transition',
            `A session cannot transition from ${session.status} to ${targetStatus}`,
        );
    }

    if (targetStatus === 'CANCELLED') {
        if (!reason) {
            throw new SessionLifecycleError(
                400,
                'reason_required',
                'A non-PII reason is required to cancel an event',
            );
        }
    }

    let adminOverride = false;
    if (session.status === 'SCHEDULED' && targetStatus === 'LIVE') {
        const earliest = session.scheduledAt.getTime() - SESSION_OPEN_EARLY_MS;
        const latest = session.scheduledAt.getTime() + SESSION_OPEN_LATE_MS;
        const outsideWindow = now.getTime() < earliest || now.getTime() > latest;
        if (outsideWindow) {
            if (actor.role !== 'ADMIN') {
                throw new SessionLifecycleError(
                    409,
                    'outside_open_window',
                    'Doors may open from 10 minutes before until 60 minutes after the scheduled start',
                );
            }
            if (!reason) {
                throw new SessionLifecycleError(
                    400,
                    'reason_required',
                    'A non-PII reason is required for an administrator to open outside the event window',
                );
            }
            adminOverride = true;
        }
    }

    const auditReason = reason || (
        targetStatus === 'LIVE'
            ? 'Doors opened'
            : targetStatus === 'ENDED'
                ? 'Event completed'
                : 'Event cancelled'
    );
    return { kind: 'transition', adminOverride, auditReason };
}

export type SessionLifecycleResult = {
    changed: boolean;
    previousStatus: ScheduledSessionStatus;
    status: ScheduledSessionStatus;
    startedAt: Date | null;
    endedAt: Date | null;
};

/** Serialize status changes with the same session-row mutex used by stage/admission. */
export async function transitionScheduledSession(input: {
    sessionId: string;
    actor: LifecycleActor;
    targetStatus: LifecycleTargetStatus;
    reason?: string;
    now?: Date;
}): Promise<SessionLifecycleResult> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "scheduled_sessions"
                WHERE "id"::text = ${input.sessionId}
                FOR UPDATE
            `,
        );

        const session = await tx.scheduledSession.findUnique({
            where: { id: input.sessionId },
            select: {
                id: true,
                status: true,
                scheduledAt: true,
                facilitatorId: true,
                startedAt: true,
                endedAt: true,
            },
        });
        if (!session) {
            throw new SessionLifecycleError(404, 'not_found', 'Event not found');
        }

        const decision = decideSessionTransition({
            session,
            actor: input.actor,
            targetStatus: input.targetStatus,
            reason: input.reason,
            now,
        });
        if (decision.kind === 'idempotent') {
            return {
                changed: false,
                previousStatus: session.status,
                status: session.status,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
            };
        }

        const updated = await tx.scheduledSession.update({
            where: { id: session.id },
            data: {
                status: input.targetStatus,
                ...(input.targetStatus === 'LIVE' ? { startedAt: now, endedAt: null } : {}),
                ...(input.targetStatus === 'ENDED' || input.targetStatus === 'CANCELLED'
                    ? { endedAt: now }
                    : {}),
            },
            select: { status: true, startedAt: true, endedAt: true },
        });

        // Audit and mutation are atomic: an unaudited lifecycle change is not
        // considered successful.
        await tx.auditLog.create({
            data: {
                actorUserId: input.actor.id,
                action: 'session.lifecycle_transition',
                targetType: 'SCHEDULED_SESSION',
                targetId: session.id,
                reason: decision.auditReason,
                metadata: {
                    previousStatus: session.status,
                    newStatus: updated.status,
                    adminOverride: decision.adminOverride,
                },
            },
        });

        return {
            changed: true,
            previousStatus: session.status,
            status: updated.status,
            startedAt: updated.startedAt,
            endedAt: updated.endedAt,
        };
    });
}
