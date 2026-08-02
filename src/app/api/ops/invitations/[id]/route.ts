import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { bedRoomIdentity, getRoomService } from '@/lib/livekit-server';
import { resolveStaffSession } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

function error(status: number, code: string, message: string) {
    return NextResponse.json({ error: code, message }, { status });
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const staff = await resolveStaffSession(request);
    if (!staff) return error(401, 'unauthenticated', 'Staff authentication required');
    if (!hasStaffCapability(staff.role, 'mutate_entitlement')) {
        return error(403, 'forbidden', 'Your role may not disable invitations');
    }

    let fields: Record<string, unknown>;
    try {
        fields = await request.json() as Record<string, unknown>;
    } catch {
        return error(400, 'invalid_request', 'Request body must be JSON');
    }
    const reason = typeof fields.reason === 'string' ? fields.reason.trim() : '';
    const revokeDerived = fields.revokeDerived;
    if (fields.action !== 'disable' || !reason || typeof revokeDerived !== 'boolean') {
        return error(400, 'invalid_request', 'Disable requires a non-PII reason and an explicit revokeDerived choice');
    }

    const { id } = await params;
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "promo_invitations" WHERE "id"::text = ${id} FOR UPDATE`,
        );
        const campaign = await tx.promoInvitation.findUnique({
            where: { id },
            include: { scheduledSession: { select: { roomName: true } } },
        });
        if (!campaign) return null;

        await tx.promoInvitation.update({
            where: { id },
            data: {
                status: 'DISABLED',
                disabledAt: campaign.disabledAt ?? now,
                disabledByUserId: staff.id,
            },
        });

        let entitlementIds: string[] = [];
        let participants: Array<{ participantIdentity: string }> = [];
        if (revokeDerived) {
            const redemptions = await tx.promoRedemption.findMany({
                where: { promoInvitationId: id },
                select: { ticketEntitlementId: true },
            });
            entitlementIds = redemptions.map((redemption) => redemption.ticketEntitlementId);
            participants = entitlementIds.length === 0 ? [] : await tx.sessionParticipant.findMany({
                where: {
                    scheduledSessionId: campaign.scheduledSessionId,
                    ticketEntitlementId: { in: entitlementIds },
                },
                select: { participantIdentity: true },
            });
            if (entitlementIds.length > 0) {
                await tx.ticketEntitlement.updateMany({
                    where: { id: { in: entitlementIds }, state: { not: 'REVOKED' } },
                    data: {
                        state: 'REVOKED',
                        revokedAt: now,
                        revokedByUserId: staff.id,
                        revocationReason: reason,
                    },
                });
                await tx.webSession.updateMany({
                    where: { ticketEntitlementId: { in: entitlementIds }, revokedAt: null },
                    data: {
                        revokedAt: now,
                        revokedByUserId: staff.id,
                        revocationReason: reason,
                    },
                });
                await tx.sessionParticipant.updateMany({
                    where: {
                        scheduledSessionId: campaign.scheduledSessionId,
                        ticketEntitlementId: { in: entitlementIds },
                        leftAt: null,
                    },
                    data: {
                        leftAt: now,
                        publishGrantedAt: null,
                        publishRevokedAt: now,
                        grantVersion: { increment: 1 },
                        grantReconcileNeeded: false,
                        grantChangedByUserId: staff.id,
                        grantReason: reason,
                    },
                });
            }
        }

        await tx.auditLog.create({
            data: {
                actorUserId: staff.id,
                actorRole: staff.role,
                action: 'promo.disable',
                targetType: 'SCHEDULED_SESSION',
                targetId: campaign.scheduledSessionId,
                reason,
                metadata: {
                    promoInvitationId: id,
                    revokeDerived,
                    revokedEntitlements: entitlementIds.length,
                },
            },
        });
        return {
            roomName: campaign.scheduledSession.roomName,
            entitlementCount: entitlementIds.length,
            participants,
        };
    });

    if (!result) return error(404, 'not_found', 'No invitation with that ID');

    let mediaCleanupFailed = false;
    if (revokeDerived && result.participants.length > 0) {
        const roomService = getRoomService();
        const bedRoomName = process.env.LIVEKIT_ROOM_NAME || 'beacon';
        const removals = await Promise.allSettled(result.participants.flatMap(({ participantIdentity }) => [
            roomService.removeParticipant(result.roomName, participantIdentity),
            roomService.removeParticipant(bedRoomName, bedRoomIdentity(participantIdentity)),
        ]));
        mediaCleanupFailed = removals.some((removal) => removal.status === 'rejected');
    }

    return NextResponse.json({
        id,
        status: 'DISABLED',
        revokeDerived,
        revokedEntitlements: result.entitlementCount,
        mediaCleanupFailed,
    }, { status: mediaCleanupFailed ? 202 : 200 });
}
