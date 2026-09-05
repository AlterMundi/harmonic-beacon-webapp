import { NextRequest, NextResponse } from 'next/server';

import { TICKET_LIVEKIT_TOKEN_TTL_SECONDS } from '@/lib/commerce-entitlement';
import { prisma } from '@/lib/db';
import { resolveStaffSession } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import {
    processParticipantGrantEffects,
    transitionParticipantGrant,
} from '@/lib/stage-grant-effects';
import {
    lockGrantCampaigns,
    lockGrantParticipants,
    lockGrantSession,
    lockGrantTickets,
} from '@/lib/stage-grant-locks';

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
    const scope = await prisma.promoInvitation.findUnique({
        where: { id },
        select: { scheduledSessionId: true },
    });
    if (!scope) return error(404, 'not_found', 'No invitation with that ID');
    const result = await prisma.$transaction(async (tx) => {
        await lockGrantSession(tx, scope.scheduledSessionId);
        await lockGrantCampaigns(tx, [id]);
        const campaign = await tx.promoInvitation.findUnique({
            where: { id },
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
        let participants: Array<{ id: string; participantIdentity: string }> = [];
        if (revokeDerived) {
            const redemptions = await tx.promoRedemption.findMany({
                where: { promoInvitationId: id },
                select: { ticketEntitlementId: true },
            });
            entitlementIds = redemptions.map((redemption) => redemption.ticketEntitlementId);
            await lockGrantTickets(tx, entitlementIds);
            participants = entitlementIds.length === 0 ? [] : await tx.sessionParticipant.findMany({
                where: {
                    scheduledSessionId: campaign.scheduledSessionId,
                    ticketEntitlementId: { in: entitlementIds },
                },
                select: { id: true, participantIdentity: true },
            });
            await lockGrantParticipants(tx, participants.map((participant) => participant.id));
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
                for (const participant of participants) {
                    await transitionParticipantGrant(tx, {
                        scheduledSessionId: campaign.scheduledSessionId,
                        participantId: participant.id,
                        canPublish: false,
                        now,
                        actorUserId: staff.id,
                        reason,
                        clearHand: true,
                        markLeft: true,
                        disconnectParticipant: true,
                        tokenHorizonAt: new Date(
                            now.getTime() + TICKET_LIVEKIT_TOKEN_TTL_SECONDS * 1000,
                        ),
                    });
                }
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
            entitlementCount: entitlementIds.length,
            participants,
        };
    });

    if (!result) return error(404, 'not_found', 'No invitation with that ID');

    let mediaCleanupFailed = false;
    if (revokeDerived && result.participants.length > 0) {
        const deliveries = await Promise.all(
            result.participants.map((participant) =>
                processParticipantGrantEffects(participant.id)),
        );
        mediaCleanupFailed = deliveries.some((delivery) => delivery.pending > 0);
    }

    return NextResponse.json({
        id,
        status: 'DISABLED',
        revokeDerived,
        revokedEntitlements: result.entitlementCount,
        mediaCleanupFailed,
    }, { status: mediaCleanupFailed ? 202 : 200 });
}
