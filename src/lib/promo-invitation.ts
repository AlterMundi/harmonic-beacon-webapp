import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { batchExceedsCap, generateTicketCode, normalizeEmail, ticketExpiresAt } from '@/lib/admission';
import { prisma } from '@/lib/db';
import {
    newSessionToken,
    webSessionExpiry,
} from '@/lib/principal';
import { ticketCodePepper, ticketCodeStorage } from '@/lib/ticket-code';

export const PROMO_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{4,13}[A-Z0-9])$/;
export const MAX_PROMO_REDEMPTIONS = 150;
export const MAX_PROMO_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function promoInvitationsEnabled(
    raw = process.env.PROMO_INVITATIONS_ENABLED,
): boolean {
    return raw === 'true';
}

export function normalizePromoCode(code: string): string {
    return code.trim().toUpperCase();
}

export function isPlausiblePromoCode(code: string): boolean {
    return PROMO_CODE_PATTERN.test(normalizePromoCode(code));
}

export function digestPromoCode(
    code: string,
    pepper = ticketCodePepper(),
): string {
    const normalized = normalizePromoCode(code);
    if (!PROMO_CODE_PATTERN.test(normalized)) {
        throw new Error('Promotion codes must contain 6–15 letters, digits, or internal hyphens');
    }
    return createHmac('sha256', pepper)
        .update(`promo-invitation:v1:${normalized}`, 'utf8')
        .digest('hex');
}

export function promoRedeemerDigest(
    email: string,
    pepper = ticketCodePepper(),
): string {
    return createHmac('sha256', pepper)
        .update(`promo-redeemer:v1:${normalizeEmail(email)}`, 'utf8')
        .digest('hex');
}

export type PromoRedemptionAttempt =
    | {
        ok: true;
        scheduledSessionId: string;
        entitlementId: string;
        codeLastFour: string;
        cookieValue: string;
        replayed: boolean;
    }
    | { ok: false; reason: 'unavailable' };

/**
 * Atomically redeem (or replay) one human promotion code.
 *
 * The campaign row and the event row are locked before capacity is read. This
 * shares the same event mutex as paid batches and comps, so the last seat can
 * only be consumed once. A successful first redemption creates an ordinary
 * BOUND/COMP TicketEntitlement; every later authorization gate is therefore
 * identical to a paid ticket. The promotion relation records provenance only.
 */
export async function redeemPromoInvitation(
    code: string,
    email: string,
    displayName: string,
    now = new Date(),
): Promise<PromoRedemptionAttempt> {
    const codeDigest = digestPromoCode(code);
    const redeemerDigest = promoRedeemerDigest(email);

    return prisma.$transaction(async (tx) => {
        const candidate = await tx.promoInvitation.findUnique({
            where: { codeDigest },
            select: { id: true, scheduledSessionId: true },
        });
        if (!candidate) return { ok: false, reason: 'unavailable' } as const;

        // Same mutex used by paid/import/comp issuance. Lock the event first,
        // then the campaign, so every capacity-taking path has one lock order.
        await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "scheduled_sessions" WHERE "id"::text = ${candidate.scheduledSessionId} FOR UPDATE`,
        );
        await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "promo_invitations" WHERE "id"::text = ${candidate.id} FOR UPDATE`,
        );

        const invitation = await tx.promoInvitation.findUnique({
            where: { id: candidate.id },
            include: { scheduledSession: true },
        });
        if (!invitation) return { ok: false, reason: 'unavailable' } as const;

        const previous = await tx.promoRedemption.findUnique({
            where: {
                promoInvitationId_redeemerDigest: {
                    promoInvitationId: invitation.id,
                    redeemerDigest,
                },
            },
            include: { ticketEntitlement: true },
        });

        let entitlement = previous?.ticketEntitlement ?? null;
        let replayed = Boolean(previous);
        if (entitlement) {
            if (
                entitlement.state !== 'BOUND' ||
                entitlement.revokedAt !== null ||
                entitlement.expiresAt <= now ||
                entitlement.boundEmail !== normalizeEmail(email)
            ) {
                return { ok: false, reason: 'unavailable' } as const;
            }
        } else {
            if (
                invitation.status !== 'ACTIVE' ||
                invitation.disabledAt !== null ||
                invitation.expiresAt <= now ||
                invitation.redemptionCount >= invitation.maxRedemptions ||
                !['SCHEDULED', 'LIVE'].includes(invitation.scheduledSession.status)
            ) {
                return { ok: false, reason: 'unavailable' } as const;
            }

            const active = await tx.ticketEntitlement.count({
                where: {
                    scheduledSessionId: invitation.scheduledSessionId,
                    state: { not: 'REVOKED' },
                },
            });
            if (batchExceedsCap(invitation.scheduledSession.attendeeCap, active, 1)) {
                return { ok: false, reason: 'unavailable' } as const;
            }

            const internalCredential = generateTicketCode();
            entitlement = await tx.ticketEntitlement.create({
                data: {
                    scheduledSessionId: invitation.scheduledSessionId,
                    ...ticketCodeStorage(internalCredential),
                    tier: 'COMP',
                    state: 'BOUND',
                    boundEmail: normalizeEmail(email),
                    boundAt: now,
                    expiresAt: ticketExpiresAt(invitation.scheduledSession.scheduledAt, now),
                    issuedByUserId: invitation.issuedByUserId,
                },
            });
            await tx.promoRedemption.create({
                data: {
                    promoInvitationId: invitation.id,
                    redeemerDigest,
                    ticketEntitlementId: entitlement.id,
                    redeemedAt: now,
                },
            });
            await tx.promoInvitation.update({
                where: { id: invitation.id },
                data: { redemptionCount: { increment: 1 } },
            });
            await tx.auditLog.create({
                data: {
                    actorUserId: null,
                    action: 'promo.redeem',
                    targetType: 'TICKET_ENTITLEMENT',
                    targetId: entitlement.id,
                    metadata: { promoInvitationId: invitation.id },
                },
            });
            replayed = false;
        }

        const issued = newSessionToken();
        await tx.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                displayName,
                ticketEntitlementId: entitlement.id,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });

        return {
            ok: true,
            scheduledSessionId: invitation.scheduledSessionId,
            entitlementId: entitlement.id,
            codeLastFour: entitlement.codeLastFour,
            cookieValue: issued.cookieValue,
            replayed,
        } as const;
    });
}
