/**
 * Staff-only single-entitlement operations: detail lookup, revoke, and
 * clear/rebind of the bound email.
 *
 * Revoke and rebind both require a non-PII reason and are role-restricted to
 * ADMIN and OPERATOR — a facilitator can look a ticket up but can never
 * silently change who it admits. Every mutation writes an audit row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { normalizeEmail } from '@/lib/admission';
import { prisma } from '@/lib/db';
import { resolveStaffSession, type StaffPrincipal } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { bedRoomIdentity } from '@/lib/livekit-server';
import { TICKET_LIVEKIT_TOKEN_TTL_SECONDS } from '@/lib/commerce-entitlement';
import { transitionParticipantGrant } from '@/lib/stage-grant-effects';
import {
    lockGrantParticipants,
    lockGrantSession,
    lockGrantTickets,
} from '@/lib/stage-grant-locks';

export const dynamic = 'force-dynamic';

function error(status: number, code: string, message: string) {
    return NextResponse.json({ error: code, message }, { status });
}

const ENTITLEMENT_INCLUDE = {
    scheduledSession: { select: { id: true, title: true, language: true, scheduledAt: true } },
    commerceEntitlement: {
        select: {
            provider: true,
            providerState: true,
            administrativeState: true,
            mediaStatus: true,
        },
    },
} as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
    const staff = await resolveStaffSession(request);
    if (!staff) {
        return error(401, 'unauthenticated', 'Staff authentication required');
    }

    const { id } = await context.params;
    const entitlement = await prisma.ticketEntitlement.findUnique({
        where: { id },
        include: ENTITLEMENT_INCLUDE,
    });
    if (!entitlement) {
        return error(404, 'not_found', 'No entitlement with that ID');
    }

    return NextResponse.json({
        entitlement: {
            id: entitlement.id,
            state: entitlement.state,
            tier: entitlement.tier,
            codeLastFour: entitlement.codeLastFour,
            boundEmail: entitlement.boundEmail,
            boundAt: entitlement.boundAt,
            expiresAt: entitlement.expiresAt,
            revokedAt: entitlement.revokedAt,
            revocationReason: entitlement.revocationReason,
            createdAt: entitlement.createdAt,
            event: entitlement.scheduledSession,
            commerce: entitlement.commerceEntitlement,
        },
    });
}

async function handleRevoke(staff: StaffPrincipal, id: string, reason: string) {
    const entitlement = await prisma.ticketEntitlement.findUnique({
        where: { id },
        select: {
            id: true,
            state: true,
            tier: true,
            codeLastFour: true,
            scheduledSessionId: true,
            commerceEntitlement: { select: { administrativeState: true } },
        },
    });
    if (!entitlement) {
        return error(404, 'not_found', 'No entitlement with that ID');
    }
    if (entitlement.state === 'REVOKED' &&
        (!entitlement.commerceEntitlement ||
            entitlement.commerceEntitlement.administrativeState === 'SUSPENDED')) {
        return error(409, 'already_revoked', 'This entitlement is already revoked');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        await lockGrantSession(tx, entitlement.scheduledSessionId);
        await lockGrantTickets(tx, [id]);
        await tx.ticketEntitlement.update({
            where: { id },
            data: {
                state: 'REVOKED',
                revokedAt: now,
                revokedByUserId: staff.id,
                revocationReason: reason,
            },
        });
        // Revocation must block token issuance immediately, including any
        // cookie the attendee already holds.
        await tx.webSession.updateMany({
            where: { ticketEntitlementId: id, revokedAt: null },
            data: { revokedAt: now, revokedByUserId: staff.id, revocationReason: reason },
        });

        const participant = await tx.sessionParticipant.findFirst({
            where: {
                scheduledSessionId: entitlement.scheduledSessionId,
                ticketEntitlementId: id,
            },
            select: { id: true, participantIdentity: true },
        });
        await lockGrantParticipants(tx, participant ? [participant.id] : []);
        const commerce = await tx.commerceEntitlement.findUnique({
            where: { ticketEntitlementId: id },
            include: { scheduledSession: { select: { roomName: true } } },
        });
        const horizon = commerce?.maxLivekitTokenExpiresAt &&
            commerce.maxLivekitTokenExpiresAt > now
            ? commerce.maxLivekitTokenExpiresAt
            : new Date(now.getTime() + TICKET_LIVEKIT_TOKEN_TTL_SECONDS * 1000);
        if (participant) {
            await transitionParticipantGrant(tx, {
                scheduledSessionId: entitlement.scheduledSessionId,
                participantId: participant.id,
                canPublish: false,
                now,
                actorUserId: staff.id,
                reason,
                clearHand: true,
                markLeft: true,
                disconnectParticipant: true,
                tokenHorizonAt: horizon,
            });
        }
        if (commerce) {
            await tx.commerceEntitlement.update({
                where: { id: commerce.id },
                data: {
                    administrativeState: 'SUSPENDED',
                    mediaStatus: participant ? 'RECONCILIATION_REQUIRED' : 'NOT_REQUIRED',
                },
            });
            if (participant) {
                await tx.commerceMediaOutbox.upsert({
                    where: {
                        commerceEntitlementId_provisionRevision: {
                            commerceEntitlementId: commerce.id,
                            provisionRevision: commerce.provisionRevision,
                        },
                    },
                    create: {
                        commerceEntitlementId: commerce.id,
                        provisionRevision: commerce.provisionRevision,
                        stageRoomName: commerce.scheduledSession.roomName,
                        participantIdentity: participant.participantIdentity,
                        bedIdentity: bedRoomIdentity(participant.participantIdentity),
                        tokenHorizonAt: horizon,
                        nextAttemptAt: now,
                    },
                    update: {
                        status: 'PENDING',
                        completedAt: null,
                        tokenHorizonAt: horizon,
                        nextAttemptAt: now,
                        lastErrorCode: null,
                    },
                });
            }
        }
        await tx.auditLog.create({
            data: {
                actorUserId: staff.id,
                actorRole: staff.role,
                action: 'ticket.revoke',
                targetType: 'TICKET_ENTITLEMENT',
                targetId: id,
                reason,
                metadata: { last4: entitlement.codeLastFour, tier: entitlement.tier },
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ id, state: 'REVOKED' });
}

async function handleRebind(staff: StaffPrincipal, id: string, email: string | undefined, reason: string) {
    const entitlement = await prisma.ticketEntitlement.findUnique({
        where: { id },
        select: {
            id: true,
            state: true,
            tier: true,
            codeLastFour: true,
            boundEmail: true,
            scheduledSessionId: true,
            commerceEntitlement: { select: { id: true } },
        },
    });
    if (!entitlement) {
        return error(404, 'not_found', 'No entitlement with that ID');
    }
    if (entitlement.state === 'REVOKED') {
        return error(409, 'revoked', 'A revoked entitlement cannot be rebound');
    }
    if (entitlement.commerceEntitlement) {
        return error(
            409,
            'managed_by_commerce',
            'Commerce-managed email changes require a higher credential generation',
        );
    }

    const newEmail = email === undefined || email === '' ? null : normalizeEmail(email);
    if (newEmail !== null && !newEmail.includes('@')) {
        return error(400, 'invalid_email', 'Provide a valid email address or omit email to clear the binding');
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
        await lockGrantSession(tx, entitlement.scheduledSessionId);
        await lockGrantTickets(tx, [id]);
        const participant = await tx.sessionParticipant.findFirst({
            where: {
                scheduledSessionId: entitlement.scheduledSessionId,
                ticketEntitlementId: id,
            },
            select: { id: true },
        });
        await lockGrantParticipants(tx, participant ? [participant.id] : []);
        const saved = await tx.ticketEntitlement.update({
            where: { id },
            data: {
                boundEmail: newEmail,
                boundAt: newEmail === null ? null : now,
                // Clearing the binding returns the ticket to ISSUED so the next
                // first-use binds fresh; (re)binding to a new email keeps it BOUND.
                state: newEmail === null ? 'ISSUED' : 'BOUND',
            },
            select: { id: true, state: true, boundEmail: true },
        });
        // A binding change is a credential rotation. Any browser authenticated
        // with the old binding must sign in again before receiving room tokens.
        await tx.webSession.updateMany({
            where: { ticketEntitlementId: id, revokedAt: null },
            data: {
                revokedAt: now,
                revokedByUserId: staff.id,
                revocationReason: `Ticket binding changed: ${reason}`,
            },
        });
        if (participant) {
            await transitionParticipantGrant(tx, {
                scheduledSessionId: entitlement.scheduledSessionId,
                participantId: participant.id,
                canPublish: false,
                now,
                actorUserId: staff.id,
                reason: `Ticket binding changed: ${reason}`,
                clearHand: true,
                markLeft: true,
                disconnectParticipant: true,
            });
        }
        await tx.auditLog.create({
            data: {
                actorUserId: staff.id,
                actorRole: staff.role,
                action: 'ticket.rebind',
                targetType: 'TICKET_ENTITLEMENT',
                targetId: id,
                reason,
                metadata: {
                    last4: entitlement.codeLastFour,
                    tier: entitlement.tier,
                    cleared: newEmail === null,
                    hadBinding: entitlement.boundEmail !== null,
                },
            },
        });
        return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ id: updated.id, state: updated.state, boundEmail: updated.boundEmail });
}

async function handleResume(staff: StaffPrincipal, id: string, reason: string) {
    const now = new Date();
    const scope = await prisma.ticketEntitlement.findUnique({
        where: { id },
        select: { scheduledSessionId: true },
    });
    if (!scope) {
        return error(404, 'not_commerce_managed', 'Only commerce-managed access can be resumed');
    }
    const result = await prisma.$transaction(async (tx) => {
        await lockGrantSession(tx, scope.scheduledSessionId);
        await lockGrantTickets(tx, [id]);
        const commerce = await tx.commerceEntitlement.findUnique({
            where: { ticketEntitlementId: id },
            include: { ticketEntitlement: true },
        });
        if (!commerce) return { status: 404 as const };
        if (commerce.administrativeState !== 'SUSPENDED') return { status: 409 as const };
        const providerActive = commerce.providerState === 'ACTIVE';
        const unexpired = commerce.ticketEntitlement.expiresAt > now;
        await tx.commerceEntitlement.update({
            where: { id: commerce.id },
            data: {
                administrativeState: 'CLEAR',
                livekitIdentityVersion: { increment: 1 },
                mediaStatus: commerce.mediaStatus === 'RECONCILIATION_REQUIRED'
                    ? 'RECONCILIATION_REQUIRED'
                    : 'NOT_REQUIRED',
            },
        });
        await tx.ticketEntitlement.update({
            where: { id },
            data: providerActive && unexpired ? {
                state: 'BOUND',
                revokedAt: null,
                revokedByUserId: null,
                revocationReason: null,
            } : {},
        });
        await tx.auditLog.create({
            data: {
                actorUserId: staff.id,
                actorRole: staff.role,
                action: 'ticket.commerce_resume',
                targetType: 'TICKET_ENTITLEMENT',
                targetId: id,
                reason,
            },
        });
        return { status: 200 as const, state: providerActive && unexpired ? 'BOUND' : 'REVOKED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.status === 404) {
        return error(404, 'not_commerce_managed', 'Only commerce-managed access can be resumed');
    }
    if (result.status === 409) {
        return error(409, 'not_suspended', 'Commerce access is not administratively suspended');
    }
    return NextResponse.json({ id, state: result.state, administrativeState: 'CLEAR' });
}

export async function POST(request: NextRequest, context: RouteContext) {
    const staff = await resolveStaffSession(request);
    if (!staff) {
        return error(401, 'unauthenticated', 'Staff authentication required');
    }

    const { id } = await context.params;

    let body: { action?: string; reason?: string; email?: string };
    try {
        body = await request.json();
    } catch {
        return error(400, 'invalid_request', 'Request body must be JSON');
    }

    if (body.action !== 'revoke' && body.action !== 'rebind' && body.action !== 'resume') {
        return error(400, 'invalid_request', 'action must be revoke, rebind, or resume');
    }
    if (!hasStaffCapability(staff.role, 'mutate_entitlement')) {
        return error(403, 'forbidden', 'Your role may not mutate an entitlement');
    }

    const reason = body.reason?.trim();
    if (!reason) {
        return error(400, 'reason_required', 'A non-PII reason is required for this action');
    }

    if (body.action === 'revoke') return handleRevoke(staff, id, reason);
    if (body.action === 'resume') return handleResume(staff, id, reason);
    return handleRebind(staff, id, body.email, reason);
}
