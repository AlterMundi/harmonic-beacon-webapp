import { NextRequest } from 'next/server';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { stableRoomIdentity } from '@/lib/livekit-server';
import { eventStaffPolicy } from '@/lib/staff-capabilities';
import {
    beaconAccountEnabled,
    validatedAccountIdentity,
} from '@/lib/account-rp';
import { isAnonymousPublicCycleAccess } from '@/lib/public-cycle';
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
    displayName: string;
    role: 'ATTENDEE' | 'FACILITATOR' | 'FACILITATOR_OP' | 'OPERATOR' | 'ADMIN';
    isAssignedFacilitator: boolean;
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

type RoomAccessBase = {
    session: RoomPrincipal['session'];
    identity: string;
    displayName: string;
    role: RoomPrincipal['role'];
    isAssignedFacilitator: boolean;
    canPublishInitially: boolean;
    ticketEntitlementId: string | null;
    staffUserId: string | null;
    existingParticipant: {
        id: string;
        participantIdentity: string;
        displayName: string | null;
        publishGrantedAt: Date | null;
        publishRevokedAt: Date | null;
        grantReconcileNeeded: boolean;
    } | null;
};

type RoomAccessResult =
    | { ok: true; access: RoomAccessBase }
    | {
        ok: false;
        status: 401 | 403 | 404;
        error: 'Authentication required' | 'Not authorized' | 'Session not found';
    };

type ParticipantGrantState = {
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    grantReconcileNeeded: boolean;
};

async function recoverConcurrentParticipant(
    access: RoomAccessBase,
    error: unknown,
): Promise<ParticipantGrantState> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
    }

    // The identity upsert has one arbiter, while the event-scoped ticket and
    // staff links are protected by separate partial unique indexes. Under a
    // fresh Stage+Beacon join PostgreSQL may report one of those independent
    // conflicts even though the other request already created the exact same
    // principal. Recover only that exact canonical winner: an unrelated
    // P2002, stale identity or mismatched principal must remain an error.
    const winner = await prisma.sessionParticipant.findFirst({
        where: {
            scheduledSessionId: access.session.id,
            participantIdentity: access.identity,
            ...(access.ticketEntitlementId
                ? { ticketEntitlementId: access.ticketEntitlementId }
                : { staffUserId: access.staffUserId! }),
        },
        select: { id: true },
    });
    if (!winner) {
        throw error;
    }

    return prisma.sessionParticipant.update({
        where: { id: winner.id },
        data: { leftAt: null },
        select: {
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantReconcileNeeded: true,
        },
    });
}

/**
 * Read-only half of room access resolution: cookie, entitlement, event
 * correspondence and policy — validated against current database state on
 * every call. It never writes: no participant upsert, no `leftAt` clearing,
 * no preflight grant. Polling GETs must use this instead of
 * `resolveRoomPrincipal`, which reconciles durable presence by design.
 */
async function resolveRoomAccess(
    request: NextRequest,
    scheduledSessionId: string,
    now = new Date(),
): Promise<RoomAccessResult> {
    const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookieValue) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }

    const webSession = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(cookieValue) },
        select: {
            id: true,
            displayName: true,
            accountIssuer: true,
            accountSubject: true,
            accountSessionId: true,
            accountDisplayName: true,
            accountValidatedAt: true,
            expiresAt: true,
            revokedAt: true,
            staffUser: {
                select: {
                    id: true,
                    name: true,
                    role: true,
                    disabledAt: true,
                    accountBinding: {
                        select: {
                            accountIssuer: true,
                            accountSubject: true,
                            disabledAt: true,
                        },
                    },
                },
            },
            ticketEntitlement: {
                select: {
                    id: true,
                    scheduledSessionId: true,
                    tier: true,
                    codeLastFour: true,
                    state: true,
                    boundEmail: true,
                    accountId: true,
                    accountIssuer: true,
                    expiresAt: true,
                    revokedAt: true,
                    scheduledSession: {
                        select: { publicAccess: true, isTest: true },
                    },
                    commerceEntitlement: {
                        select: { livekitIdentityVersion: true },
                    },
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
    const accountRequired = beaconAccountEnabled() && !isAnonymousPublicCycleAccess(webSession);
    const account = accountRequired
        ? await validatedAccountIdentity(webSession, now)
        : null;
    if (accountRequired && !account) {
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
    let role: RoomPrincipal['role'];
    let canPublishInitially = false;
    let isAssignedFacilitator = false;

    if (ticket) {
        if (
            scheduledSession.status !== 'LIVE' ||
            ticket.scheduledSessionId !== scheduledSession.id ||
            ticket.state !== 'BOUND' ||
            (accountRequired
                ? ticket.accountId !== account?.subject ||
                    ticket.accountIssuer !== account?.issuer
                : !ticket.boundEmail) ||
            ticket.revokedAt ||
            ticket.expiresAt <= now
        ) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        principalId = ticket.commerceEntitlement
            ? `${ticket.id}:v${ticket.commerceEntitlement.livekitIdentityVersion}`
            : ticket.id;
        principalKind = 'ticket';
        ticketEntitlementId = ticket.id;
        displayName = webSession.displayName?.trim() || 'Attendee';
        role = 'ATTENDEE';
    } else {
        if (
            !staff ||
            staff.disabledAt ||
            (accountRequired && (
                !staff.accountBinding ||
                staff.accountBinding.disabledAt ||
                staff.accountBinding.accountIssuer !== account?.issuer ||
                staff.accountBinding.accountSubject !== account?.subject
            )) ||
            (scheduledSession.status !== 'SCHEDULED' &&
                scheduledSession.status !== 'LIVE')
        ) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        const policy = eventStaffPolicy(
            staff.role,
            scheduledSession.facilitatorId === staff.id,
        );
        if (!policy.canOperateEvent) {
            return { ok: false, status: 403, error: 'Not authorized' };
        }

        principalId = staff.id;
        principalKind = 'staff';
        staffUserId = staff.id;
        canPublishInitially = policy.canPublishInitially;
        isAssignedFacilitator = policy.isAssignedFacilitator;
        displayName = staff.name?.trim() || (
            policy.isAssignedFacilitator
                ? 'Facilitator'
                : staff.role === 'OPERATOR'
                    ? 'Operator'
                    : staff.role === 'ADMIN'
                        ? 'Administrator'
                        : 'Facilitator operator'
        );
        role = staff.role;
    }

    const baselineIdentity = stableRoomIdentity(
        scheduledSession.id,
        principalKind,
        principalId,
    );
    // Read-only lookup: the existing row, when there is one, informs
    // canPublish for viewers without materializing presence.
    const existingParticipant = await prisma.sessionParticipant.findFirst({
        where: {
            scheduledSessionId: scheduledSession.id,
            ...(ticketEntitlementId
                ? { ticketEntitlementId }
                : { staffUserId: staffUserId! }),
        },
        select: {
            id: true,
            participantIdentity: true,
            displayName: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantReconcileNeeded: true,
        },
    });

    return {
        ok: true,
        access: {
            session: {
                id: scheduledSession.id,
                title: scheduledSession.title,
                roomName: scheduledSession.roomName,
                status: scheduledSession.status,
                startedAt: scheduledSession.startedAt,
            },
            // Once materialized, the participant row is the durable authority.
            // Revocations rotate this identity so stale JWTs and late RPCs are
            // fenced away from the current connection.
            identity: existingParticipant?.participantIdentity ?? baselineIdentity,
            displayName: existingParticipant?.displayName?.trim() || displayName,
            role,
            isAssignedFacilitator,
            canPublishInitially,
            ticketEntitlementId,
            staffUserId,
            existingParticipant,
        },
    };
}

/**
 * Read-only room viewer for polling GETs (TAP-02 review): validates the web
 * session, entitlement and event correspondence exactly like the token
 * route, but performs zero writes and zero presence changes. `canPublish`
 * reflects the existing participant row only — a viewer who never joined
 * truthfully has no grant.
 */
export async function resolveRoomViewer(
    request: NextRequest,
    scheduledSessionId: string,
    now = new Date(),
): Promise<RoomEntitlementResult> {
    const result = await resolveRoomAccess(request, scheduledSessionId, now);
    if (!result.ok) {
        return result;
    }
    const { access } = result;
    return {
        ok: true,
        principal: {
            session: access.session,
            identity: access.identity,
            displayName: access.displayName,
            role: access.role,
            isAssignedFacilitator: access.isAssignedFacilitator,
            canPublish:
                access.existingParticipant !== null &&
                access.existingParticipant.publishGrantedAt !== null &&
                access.existingParticipant.publishRevokedAt === null &&
                !access.existingParticipant.grantReconcileNeeded,
            ticketEntitlementId: access.ticketEntitlementId,
            staffUserId: access.staffUserId,
        },
    };
}

/**
 * Resolve the opaque weekend web session against current database state.
 *
 * This is intentionally called for every token request: a revoked cookie or
 * ticket stops working immediately. Ticket sessions are event-scoped. Global
 * operators/admins may observe any active event, while a facilitator is scoped
 * to the event they facilitate.
 *
 * Joining is a write: this resolver reconciles the durable participant row
 * (stable identity, cleared `leftAt`, facilitator preflight grant). Read-only
 * polling surfaces must use {@link resolveRoomViewer} instead.
 */
export async function resolveRoomPrincipal(
    request: NextRequest,
    scheduledSessionId: string,
    now = new Date(),
): Promise<RoomEntitlementResult> {
    const result = await resolveRoomAccess(request, scheduledSessionId, now);
    if (!result.ok) {
        return result;
    }
    const { access } = result;
    const existingParticipant = access.existingParticipant;
    // Once a participant exists, its identity is durable authority. Grant
    // revocations may rotate it specifically to fence old tokens; routine
    // login must never overwrite that rotation with a recomputed baseline.
    let participant: ParticipantGrantState;
    try {
        participant = existingParticipant
            ? await prisma.sessionParticipant.update({
                where: { id: existingParticipant.id },
                data: {
                    // Joining again resumes presence without rewriting identity
                    // or the alias already captured for this participation.
                    leftAt: null,
                },
                select: {
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                    grantReconcileNeeded: true,
                },
            })
            : await prisma.sessionParticipant.upsert({
                where: {
                    scheduledSessionId_participantIdentity: {
                        scheduledSessionId: scheduledSessionId,
                        participantIdentity: access.identity,
                    },
                },
                create: {
                    scheduledSessionId: scheduledSessionId,
                    participantIdentity: access.identity,
                    displayName: access.displayName,
                    ticketEntitlementId: access.ticketEntitlementId,
                    staffUserId: access.staffUserId,
                    publishGrantedAt: access.canPublishInitially ? now : null,
                    grantVersion: access.canPublishInitially ? 1 : 0,
                    grantReason: access.canPublishInitially
                        ? 'Facilitator preflight grant'
                        : null,
                },
                update: {
                    leftAt: null,
                },
                select: {
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                    grantReconcileNeeded: true,
                },
            });
    } catch (error) {
        participant = await recoverConcurrentParticipant(access, error);
    }

    return {
        ok: true,
        principal: {
            session: access.session,
            identity: access.identity,
            displayName: access.displayName,
            role: access.role,
            isAssignedFacilitator: access.isAssignedFacilitator,
            canPublish:
                participant.publishGrantedAt !== null &&
                participant.publishRevokedAt === null &&
                !participant.grantReconcileNeeded,
            ticketEntitlementId: access.ticketEntitlementId,
            staffUserId: access.staffUserId,
        },
    };
}
