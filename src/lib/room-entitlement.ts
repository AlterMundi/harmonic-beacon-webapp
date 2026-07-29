import { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { stableRoomIdentity } from '@/lib/livekit-server';
import {
    SESSION_COOKIE_NAME,
    digestSessionToken,
} from '@/lib/session-auth';

export type RoomPrincipal = {
    session: {
        id: string;
        title: string;
        roomName: string;
        status: 'SCHEDULED' | 'LIVE';
        startedAt: Date | null;
    };
    identity: string;
    displayName: 'Attendee' | 'Facilitator' | 'Operator' | 'Administrator';
    canPublish: boolean;
    ticketEntitlementId: string | null;
    staffUserId: string | null;
};

export type RoomEntitlementResult =
    | { ok: true; principal: RoomPrincipal }
    | {
        ok: false;
        status: 401 | 403 | 404;
        error: 'Authentication required' | 'Not authorized' | 'Session not found';
    };

/**
 * Resolve the opaque weekend web session against current database state.
 *
 * This is intentionally called for every token request: a revoked cookie or
 * ticket stops working immediately. Ticket sessions are event-scoped. Global
 * operators/admins may observe any active event, while a facilitator is scoped
 * to the event they facilitate.
 */
export async function resolveRoomPrincipal(
    request: NextRequest,
    scheduledSessionId: string,
    now = new Date(),
): Promise<RoomEntitlementResult> {
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookieValue) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }

    const webSession = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(cookieValue) },
        select: {
            expiresAt: true,
            revokedAt: true,
            staffUser: {
                select: {
                    id: true,
                    role: true,
                    disabledAt: true,
                },
            },
            ticketEntitlement: {
                select: {
                    id: true,
                    scheduledSessionId: true,
                    state: true,
                    boundEmail: true,
                    expiresAt: true,
                    revokedAt: true,
                },
            },
        },
    });

    if (
        !webSession ||
        webSession.revokedAt ||
        webSession.expiresAt <= now
    ) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id: scheduledSessionId },
        select: {
            id: true,
            title: true,
            roomName: true,
            status: true,
            startedAt: true,
            facilitatorId: true,
        },
    });

    if (!scheduledSession) {
        return { ok: false, status: 404, error: 'Session not found' };
    }

    const ticket = webSession.ticketEntitlement;
    const staff = webSession.staffUser;
    const hasExactlyOnePrincipal = Boolean(ticket) !== Boolean(staff);
    if (!hasExactlyOnePrincipal) {
        return { ok: false, status: 403, error: 'Not authorized' };
    }

    let principalId: string;
    let principalKind: 'ticket' | 'staff';
    let ticketEntitlementId: string | null = null;
    let staffUserId: string | null = null;
    let displayName: RoomPrincipal['displayName'];
    let facilitatorCanPublish = false;

    if (ticket) {
        if (
            scheduledSession.status !== 'LIVE' ||
            ticket.scheduledSessionId !== scheduledSession.id ||
            ticket.state !== 'BOUND' ||
            !ticket.boundEmail ||
            ticket.revokedAt ||
            ticket.expiresAt <= now
        ) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        principalId = ticket.id;
        principalKind = 'ticket';
        ticketEntitlementId = ticket.id;
        displayName = 'Attendee';
    } else {
        if (
            !staff ||
            staff.disabledAt ||
            (scheduledSession.status !== 'SCHEDULED' &&
                scheduledSession.status !== 'LIVE')
        ) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        const isFacilitator =
            staff.role === 'FACILITATOR' &&
            scheduledSession.facilitatorId === staff.id;
        const isOperationsStaff =
            staff.role === 'OPERATOR' || staff.role === 'ADMIN';
        if (!isFacilitator && !isOperationsStaff) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        principalId = staff.id;
        principalKind = 'staff';
        staffUserId = staff.id;
        facilitatorCanPublish = isFacilitator;
        displayName =
            staff.role === 'FACILITATOR'
                ? 'Facilitator'
                : staff.role === 'OPERATOR'
                    ? 'Operator'
                    : 'Administrator';
    }

    const identity = stableRoomIdentity(
        scheduledSession.id,
        principalKind,
        principalId,
    );
    const participant = await prisma.sessionParticipant.upsert({
        where: {
            scheduledSessionId_participantIdentity: {
                scheduledSessionId: scheduledSession.id,
                participantIdentity: identity,
            },
        },
        create: {
            scheduledSessionId: scheduledSession.id,
            participantIdentity: identity,
            ticketEntitlementId,
            staffUserId,
            publishGrantedAt: facilitatorCanPublish ? now : null,
            grantVersion: facilitatorCanPublish ? 1 : 0,
            grantReason: facilitatorCanPublish
                ? 'Facilitator preflight grant'
                : null,
        },
        update: {
            leftAt: null,
        },
        select: {
            publishGrantedAt: true,
            publishRevokedAt: true,
        },
    });

    return {
        ok: true,
        principal: {
            session: {
                id: scheduledSession.id,
                title: scheduledSession.title,
                roomName: scheduledSession.roomName,
                status: scheduledSession.status,
                startedAt: scheduledSession.startedAt,
            },
            identity,
            displayName,
            canPublish:
                participant.publishGrantedAt !== null &&
                participant.publishRevokedAt === null,
            ticketEntitlementId,
            staffUserId,
        },
    };
}
