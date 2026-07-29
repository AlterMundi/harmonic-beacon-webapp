/**
 * Staff-only single-entitlement operations: detail lookup, revoke, and
 * clear/rebind of the bound email.
 *
 * Revoke and rebind both require a non-PII reason and are role-restricted to
 * ADMIN and OPERATOR — a facilitator can look a ticket up but can never
 * silently change who it admits. Every mutation writes an audit row.
 */

import { NextRequest, NextResponse } from 'next/server';

import { normalizeEmail } from '@/lib/admission';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { hasAnyRole, resolveStaffSession, type StaffPrincipal } from '@/lib/ops-auth';

export const dynamic = 'force-dynamic';

const MUTATION_ROLES = ['ADMIN', 'OPERATOR'] as const;

function error(status: number, code: string, message: string) {
    return NextResponse.json({ error: code, message }, { status });
}

const ENTITLEMENT_INCLUDE = {
    scheduledSession: { select: { id: true, title: true, language: true, scheduledAt: true } },
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
        },
    });
}

async function handleRevoke(staff: StaffPrincipal, id: string, reason: string) {
    const entitlement = await prisma.ticketEntitlement.findUnique({
        where: { id },
        select: { id: true, state: true, tier: true, codeLastFour: true },
    });
    if (!entitlement) {
        return error(404, 'not_found', 'No entitlement with that ID');
    }
    if (entitlement.state === 'REVOKED') {
        return error(409, 'already_revoked', 'This entitlement is already revoked');
    }

    const now = new Date();
    await prisma.$transaction([
        prisma.ticketEntitlement.update({
            where: { id },
            data: {
                state: 'REVOKED',
                revokedAt: now,
                revokedByUserId: staff.id,
                revocationReason: reason,
            },
        }),
        // Revocation must block token issuance immediately, including any
        // cookie the attendee already holds.
        prisma.webSession.updateMany({
            where: { ticketEntitlementId: id, revokedAt: null },
            data: { revokedAt: now, revokedByUserId: staff.id, revocationReason: reason },
        }),
    ]);

    await recordAuditEvent({
        actorUserId: staff.id,
        action: 'ticket.revoke',
        targetType: 'TICKET_ENTITLEMENT',
        targetId: id,
        reason,
        metadata: { last4: entitlement.codeLastFour, tier: entitlement.tier },
    });

    return NextResponse.json({ id, state: 'REVOKED' });
}

async function handleRebind(staff: StaffPrincipal, id: string, email: string | undefined, reason: string) {
    const entitlement = await prisma.ticketEntitlement.findUnique({
        where: { id },
        select: { id: true, state: true, tier: true, codeLastFour: true, boundEmail: true },
    });
    if (!entitlement) {
        return error(404, 'not_found', 'No entitlement with that ID');
    }
    if (entitlement.state === 'REVOKED') {
        return error(409, 'revoked', 'A revoked entitlement cannot be rebound');
    }

    const newEmail = email === undefined || email === '' ? null : normalizeEmail(email);
    if (newEmail !== null && !newEmail.includes('@')) {
        return error(400, 'invalid_email', 'Provide a valid email address or omit email to clear the binding');
    }

    const now = new Date();
    const [updated] = await prisma.$transaction([
        prisma.ticketEntitlement.update({
            where: { id },
            data: {
                boundEmail: newEmail,
                boundAt: newEmail === null ? null : now,
                // Clearing the binding returns the ticket to ISSUED so the next
                // first-use binds fresh; (re)binding to a new email keeps it BOUND.
                state: newEmail === null ? 'ISSUED' : 'BOUND',
            },
            select: { id: true, state: true, boundEmail: true },
        }),
        // A binding change is a credential rotation. Any browser authenticated
        // with the old binding must sign in again before receiving room tokens.
        prisma.webSession.updateMany({
            where: { ticketEntitlementId: id, revokedAt: null },
            data: {
                revokedAt: now,
                revokedByUserId: staff.id,
                revocationReason: `Ticket binding changed: ${reason}`,
            },
        }),
    ]);

    await recordAuditEvent({
        actorUserId: staff.id,
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
    });

    return NextResponse.json({ id: updated.id, state: updated.state, boundEmail: updated.boundEmail });
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

    if (body.action !== 'revoke' && body.action !== 'rebind') {
        return error(400, 'invalid_request', 'action must be revoke or rebind');
    }
    if (!hasAnyRole(staff, [...MUTATION_ROLES])) {
        return error(403, 'forbidden', 'Only ADMIN or OPERATOR may mutate an entitlement');
    }

    const reason = body.reason?.trim();
    if (!reason) {
        return error(400, 'reason_required', 'A non-PII reason is required for this action');
    }

    return body.action === 'revoke'
        ? handleRevoke(staff, id, reason)
        : handleRebind(staff, id, body.email, reason);
}
