import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
    getRoomService,
    stagePublisherPermission,
} from '@/lib/livekit-server';
import type { RoomPrincipal } from '@/lib/room-entitlement';
import { digestSessionToken } from '@/lib/session-auth';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const STAFF_LIVEKIT_TOKEN_TTL_SECONDS = 4 * 60 * 60;
const LIVEKIT_PERMISSION_TIMEOUT_SECONDS = 5;

type CurrentPrincipalInput = {
    cookieValue: string;
    principal: RoomPrincipal;
    expectedIdentity: string;
    now: Date;
};

type LockedCurrentPrincipal = {
    participantId: string;
    roomName: string;
    displayName: string;
    effectiveCanPublish: boolean;
    isAssignedFacilitator: boolean;
    commerceEntitlementId: string | null;
};

type FinalizeRoomTokenInput = Omit<CurrentPrincipalInput, 'now'> & {
    expectedCanPublish: boolean;
    tokenExpiresAt: Date;
    now?: Date;
};

type ActivateRoomPublicationInput = Omit<CurrentPrincipalInput, 'now'> & {
    now?: Date;
};

/**
 * Acquire the repository-wide authority locks and revalidate the exact web
 * session, principal, participant identity and current grant. Callers may
 * perform a bounded LiveKit projection before this transaction releases the
 * locks, so a concurrent revocation is necessarily ordered after it and leaves
 * a durable negative effect.
 */
async function lockCurrentPrincipal(
    tx: Prisma.TransactionClient,
    input: CurrentPrincipalInput,
): Promise<LockedCurrentPrincipal | null> {
    const sessions = await tx.$queryRaw<Array<{
        facilitator_id: string;
        room_name: string;
        status: 'SCHEDULED' | 'LIVE';
    }>>(Prisma.sql`
        SELECT "facilitator_id", "room_name", "status"
        FROM "scheduled_sessions"
        WHERE "id"::text = ${input.principal.session.id}
          AND "status" IN ('SCHEDULED', 'LIVE')
        FOR UPDATE
    `);
    const session = sessions[0];
    if (!session) return null;
    if (input.principal.ticketEntitlementId && session.status !== 'LIVE') return null;

    let commerceEntitlementId: string | null = null;
    let isAssignedFacilitator = false;
    if (input.principal.ticketEntitlementId) {
        await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "ticket_entitlements"
            WHERE "id"::text = ${input.principal.ticketEntitlementId}
            FOR UPDATE
        `);
        const webSession = await tx.webSession.findUnique({
            where: { tokenDigest: digestSessionToken(input.cookieValue) },
            select: {
                ticketEntitlementId: true,
                revokedAt: true,
                expiresAt: true,
                ticketEntitlement: {
                    select: {
                        scheduledSessionId: true,
                        state: true,
                        revokedAt: true,
                        expiresAt: true,
                        commerceEntitlement: {
                            select: {
                                id: true,
                                providerState: true,
                                administrativeState: true,
                            },
                        },
                    },
                },
            },
        });
        const ticket = webSession?.ticketEntitlement;
        const commerce = ticket?.commerceEntitlement;
        if (
            !webSession || webSession.ticketEntitlementId !== input.principal.ticketEntitlementId ||
            webSession.revokedAt || webSession.expiresAt <= input.now || !ticket ||
            ticket.scheduledSessionId !== input.principal.session.id ||
            ticket.state !== 'BOUND' || ticket.revokedAt || ticket.expiresAt <= input.now ||
            (commerce && (
                commerce.providerState !== 'ACTIVE' ||
                commerce.administrativeState !== 'CLEAR'
            ))
        ) return null;
        commerceEntitlementId = commerce?.id ?? null;
    } else if (input.principal.staffUserId) {
        await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "users"
            WHERE "id"::text = ${input.principal.staffUserId}
            FOR UPDATE
        `);
        const webSession = await tx.webSession.findUnique({
            where: { tokenDigest: digestSessionToken(input.cookieValue) },
            select: {
                staffUserId: true,
                revokedAt: true,
                expiresAt: true,
                staffUser: { select: { role: true, disabledAt: true } },
            },
        });
        const staff = webSession?.staffUser;
        if (
            !webSession || webSession.staffUserId !== input.principal.staffUserId ||
            webSession.revokedAt || webSession.expiresAt <= input.now || !staff ||
            staff.disabledAt
        ) return null;
        const policy = eventStaffPolicy(
            staff.role,
            session.facilitator_id === input.principal.staffUserId,
        );
        if (!policy.canOperateEvent) return null;
        isAssignedFacilitator = policy.isAssignedFacilitator;
    } else {
        return null;
    }

    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "session_participants"
        WHERE "scheduled_session_id"::text = ${input.principal.session.id}
          AND "participant_identity" = ${input.expectedIdentity}
        FOR UPDATE
    `);
    const participant = await tx.sessionParticipant.findFirst({
        where: {
            scheduledSessionId: input.principal.session.id,
            participantIdentity: input.expectedIdentity,
            ...(input.principal.ticketEntitlementId
                ? { ticketEntitlementId: input.principal.ticketEntitlementId }
                : { staffUserId: input.principal.staffUserId! }),
        },
        select: {
            id: true,
            displayName: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantReconcileNeeded: true,
        },
    });
    if (!participant) return null;

    return {
        participantId: participant.id,
        roomName: session.room_name,
        displayName: participant.displayName?.trim() || 'Participant',
        effectiveCanPublish: participant.publishGrantedAt !== null &&
            participant.publishRevokedAt === null &&
            !participant.grantReconcileNeeded,
        isAssignedFacilitator,
        commerceEntitlementId,
    };
}

const TRANSACTION_OPTIONS = {
    // Explicit locks are the serialization boundary. READ COMMITTED lets a
    // queued issuer see the newest committed authority after each lock wait.
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 10_000,
} as const;

/**
 * Final authorization fence between JWT construction and returning it to the
 * browser. All JWTs are subscribe-only; the horizon is still retained because
 * revoked credentials must also lose room and Beacon-bed access.
 */
export async function finalizeRoomTokenIssue(
    input: FinalizeRoomTokenInput,
): Promise<boolean> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const current = await lockCurrentPrincipal(tx, { ...input, now });
        if (!current || current.effectiveCanPublish !== input.expectedCanPublish) return false;

        if (current.commerceEntitlementId) {
            await tx.commerceEntitlement.updateMany({
                where: {
                    id: current.commerceEntitlementId,
                    OR: [
                        { maxLivekitTokenExpiresAt: null },
                        { maxLivekitTokenExpiresAt: { lt: input.tokenExpiresAt } },
                    ],
                },
                data: { maxLivekitTokenExpiresAt: input.tokenExpiresAt },
            });
        }
        await tx.sessionParticipant.updateMany({
            where: {
                id: current.participantId,
                participantIdentity: input.expectedIdentity,
                OR: [
                    { maxLivekitTokenExpiresAt: null },
                    { maxLivekitTokenExpiresAt: { lt: input.tokenExpiresAt } },
                ],
            },
            data: { maxLivekitTokenExpiresAt: input.tokenExpiresAt },
        });
        return true;
    }, TRANSACTION_OPTIONS);
}

/**
 * Elevate only a connected, current identity after it joined with a
 * subscribe-only token. Holding the authority locks through the bounded RPC
 * makes activation and revocation strictly ordered. A replayed JWT for a
 * retired identity cannot name or elevate itself through this API.
 */
export async function activateRoomPublication(
    input: ActivateRoomPublicationInput,
): Promise<boolean> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const current = await lockCurrentPrincipal(tx, { ...input, now });
        if (!current?.effectiveCanPublish) return false;

        await getRoomService(LIVEKIT_PERMISSION_TIMEOUT_SECONDS).updateParticipant(
            current.roomName,
            input.expectedIdentity,
            {
                name: current.displayName,
                permission: stagePublisherPermission(current.isAssignedFacilitator),
            },
        );
        return true;
    }, TRANSACTION_OPTIONS);
}
