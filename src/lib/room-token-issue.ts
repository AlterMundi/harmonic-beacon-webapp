import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import type { RoomPrincipal } from '@/lib/room-entitlement';
import { digestSessionToken } from '@/lib/session-auth';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const STAFF_LIVEKIT_TOKEN_TTL_SECONDS = 4 * 60 * 60;

type FinalizeRoomTokenInput = {
    cookieValue: string;
    principal: RoomPrincipal;
    expectedIdentity: string;
    expectedCanPublish: boolean;
    tokenExpiresAt: Date;
    now?: Date;
};

/**
 * Final authorization fence between JWT construction and returning it to the
 * browser. Session, entitlement/account and participant are locked in the
 * repository-wide order. A concurrent demotion or credential rotation either
 * happens first and makes the identity/revision check fail, or happens after
 * this transaction and inherits the exact token horizon it must fence.
 */
export async function finalizeRoomTokenIssue(
    input: FinalizeRoomTokenInput,
): Promise<boolean> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const sessions = await tx.$queryRaw<Array<{
            facilitator_id: string;
            status: 'SCHEDULED' | 'LIVE';
        }>>(Prisma.sql`
            SELECT "facilitator_id", "status"
            FROM "scheduled_sessions"
            WHERE "id"::text = ${input.principal.session.id}
              AND "status" IN ('SCHEDULED', 'LIVE')
            FOR UPDATE
        `);
        if (!sessions[0]) return false;
        if (input.principal.ticketEntitlementId && sessions[0].status !== 'LIVE') return false;

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
                webSession.revokedAt || webSession.expiresAt <= now || !ticket ||
                ticket.scheduledSessionId !== input.principal.session.id ||
                ticket.state !== 'BOUND' || ticket.revokedAt || ticket.expiresAt <= now ||
                (commerce && (
                    commerce.providerState !== 'ACTIVE' ||
                    commerce.administrativeState !== 'CLEAR'
                ))
            ) return false;

            if (commerce) {
                await tx.commerceEntitlement.updateMany({
                    where: {
                        id: commerce.id,
                        OR: [
                            { maxLivekitTokenExpiresAt: null },
                            { maxLivekitTokenExpiresAt: { lt: input.tokenExpiresAt } },
                        ],
                    },
                    data: { maxLivekitTokenExpiresAt: input.tokenExpiresAt },
                });
            }
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
                webSession.revokedAt || webSession.expiresAt <= now || !staff ||
                staff.disabledAt ||
                !eventStaffPolicy(
                    staff.role,
                    sessions[0].facilitator_id === input.principal.staffUserId,
                ).canOperateEvent
            ) return false;
        } else {
            return false;
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
                publishGrantedAt: true,
                publishRevokedAt: true,
                grantReconcileNeeded: true,
            },
        });
        if (!participant) return false;
        const effectiveCanPublish = participant.publishGrantedAt !== null &&
            participant.publishRevokedAt === null &&
            !participant.grantReconcileNeeded;
        if (effectiveCanPublish !== input.expectedCanPublish) return false;

        await tx.sessionParticipant.updateMany({
            where: {
                id: participant.id,
                participantIdentity: input.expectedIdentity,
                OR: [
                    { maxLivekitTokenExpiresAt: null },
                    { maxLivekitTokenExpiresAt: { lt: input.tokenExpiresAt } },
                ],
            },
            data: { maxLivekitTokenExpiresAt: input.tokenExpiresAt },
        });
        return true;
    }, {
        // The explicit session -> principal -> participant row locks are the
        // serialization boundary. READ COMMITTED gives a queued token issuer
        // a fresh snapshot after each lock wait; SERIALIZABLE instead aborts
        // otherwise-valid concurrent joins to the same event with SQLSTATE
        // 40001, which turns a harmless login burst into room-token 500s.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
}
