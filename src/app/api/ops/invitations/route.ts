import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { resolveStaffSession } from '@/lib/ops-auth';
import {
    digestPromoCode,
    isPlausiblePromoCode,
    MAX_PROMO_LIFETIME_MS,
    MAX_PROMO_REDEMPTIONS,
    promoInvitationsEnabled,
} from '@/lib/promo-invitation';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { ticketExpiresAt } from '@/lib/admission';

export const dynamic = 'force-dynamic';

function error(status: number, code: string, message: string) {
    return NextResponse.json({ error: code, message }, { status });
}

const CAMPAIGN_INCLUDE = {
    scheduledSession: {
        select: { id: true, title: true, language: true, scheduledAt: true },
    },
} as const;

function serializeCampaign(campaign: {
    id: string;
    label: string;
    status: string;
    expiresAt: Date;
    maxRedemptions: number;
    redemptionCount: number;
    disabledAt: Date | null;
    createdAt: Date;
    scheduledSession: { id: string; title: string; language: string; scheduledAt: Date };
}) {
    return {
        id: campaign.id,
        label: campaign.label,
        status: campaign.status,
        expiresAt: campaign.expiresAt,
        maxRedemptions: campaign.maxRedemptions,
        redemptionCount: campaign.redemptionCount,
        disabledAt: campaign.disabledAt,
        createdAt: campaign.createdAt,
        event: campaign.scheduledSession,
    };
}

export async function GET(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) return error(401, 'unauthenticated', 'Staff authentication required');
    if (!hasStaffCapability(staff.role, 'look_up_admission')) {
        return error(403, 'forbidden', 'Your role may not view invitations');
    }

    const campaigns = await prisma.promoInvitation.findMany({
        include: CAMPAIGN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
    return NextResponse.json({
        redemptionEnabled: promoInvitationsEnabled(),
        campaigns: campaigns.map(serializeCampaign),
    });
}

export async function POST(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) return error(401, 'unauthenticated', 'Staff authentication required');
    if (!hasStaffCapability(staff.role, 'issue_comp')) {
        return error(403, 'forbidden', 'Your role may not create complimentary invitations');
    }

    let fields: Record<string, unknown>;
    try {
        fields = await request.json() as Record<string, unknown>;
    } catch {
        return error(400, 'invalid_request', 'Request body must be JSON');
    }
    const sessionId = typeof fields.sessionId === 'string' ? fields.sessionId : '';
    const code = typeof fields.code === 'string' ? fields.code : '';
    const label = typeof fields.label === 'string' ? fields.label.trim() : '';
    const expiresAt = typeof fields.expiresAt === 'string' ? new Date(fields.expiresAt) : new Date(Number.NaN);
    const maxRedemptions = typeof fields.maxRedemptions === 'number' ? fields.maxRedemptions : Number.NaN;
    const now = new Date();

    if (!sessionId || !isPlausiblePromoCode(code) || label.length < 3 || label.length > 80) {
        return error(400, 'invalid_request', 'Session, a 6–15 character code, and a 3–80 character label are required');
    }
    if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > MAX_PROMO_REDEMPTIONS) {
        return error(400, 'invalid_capacity', `Capacity must be between 1 and ${MAX_PROMO_REDEMPTIONS}`);
    }
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > now.getTime() + MAX_PROMO_LIFETIME_MS) {
        return error(400, 'invalid_expiry', 'Invitation expiry must be within the next seven days');
    }

    let codeDigest: string;
    try {
        codeDigest = digestPromoCode(code);
    } catch {
        return error(500, 'misconfigured', 'Invitation service is unavailable');
    }

    try {
        const campaign = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "scheduled_sessions" WHERE "id"::text = ${sessionId} FOR UPDATE`,
            );
            const session = await tx.scheduledSession.findUnique({ where: { id: sessionId } });
            if (!session) return null;
            if (!['SCHEDULED', 'LIVE'].includes(session.status)) {
                throw new Error('SESSION_UNAVAILABLE');
            }
            if (expiresAt > ticketExpiresAt(session.scheduledAt, now)) {
                throw new Error('EXPIRY_AFTER_ACCESS');
            }
            const created = await tx.promoInvitation.create({
                data: {
                    scheduledSessionId: sessionId,
                    codeDigest,
                    label,
                    expiresAt,
                    maxRedemptions,
                    issuedByUserId: staff.id,
                },
                include: CAMPAIGN_INCLUDE,
            });
            await tx.auditLog.create({
                data: {
                    actorUserId: staff.id,
                    actorRole: staff.role,
                    action: 'promo.create',
                    targetType: 'SCHEDULED_SESSION',
                    targetId: sessionId,
                    metadata: {
                        promoInvitationId: created.id,
                        maxRedemptions,
                        expiresAt: expiresAt.toISOString(),
                    },
                },
            });
            return created;
        });

        if (!campaign) return error(404, 'not_found', 'No scheduled session with that ID');
        return NextResponse.json({
            redemptionEnabled: promoInvitationsEnabled(),
            campaign: serializeCampaign(campaign),
        }, { status: 201 });
    } catch (failure) {
        if (failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === 'P2002') {
            return error(409, 'code_unavailable', 'Choose a different invitation code');
        }
        if (failure instanceof Error && failure.message === 'SESSION_UNAVAILABLE') {
            return error(409, 'session_unavailable', 'This session no longer accepts invitations');
        }
        if (failure instanceof Error && failure.message === 'EXPIRY_AFTER_ACCESS') {
            return error(400, 'invalid_expiry', 'Invitation cannot outlive event access');
        }
        return error(500, 'unavailable', 'Invitation could not be created');
    }
}
