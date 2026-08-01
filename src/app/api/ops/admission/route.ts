/**
 * Staff-only admission support: ticket lookup, batch generation/import, and
 * comp/override issuance.
 *
 * Every handler resolves the staff session against the database; there is no
 * attendee-accessible path here. Plaintext ticket codes appear only in the
 * one-time CSV body returned to the operator — the database stores digests
 * (see src/lib/ticket-code.ts) and nothing in this module logs a code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import {
    batchExceedsCap,
    buildTicketCsv,
    classifyLookup,
    generateTicketCodes,
    parseTicketCsv,
    ticketExpiresAt,
} from '@/lib/admission';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { resolveStaffSession, type StaffPrincipal } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { ticketCodeStorage } from '@/lib/ticket-code';

export const dynamic = 'force-dynamic';

const MAX_BATCH_COUNT = 150;
const GENERATABLE_TIERS = ['GLOBAL_NORTH', 'GLOBAL_SOUTH'] as const;
const COMP_TIERS = ['COMP', 'SUPPORT_OVERRIDE'] as const;

function loginUrlPrefix(): string {
    return process.env.TICKET_LOGIN_URL_PREFIX?.trim() || 'https://live.harmonicbeacon.com/';
}

function error(status: number, code: string, message: string) {
    return NextResponse.json({ error: code, message }, { status });
}

function serializeEntitlement(entitlement: {
    id: string;
    state: string;
    tier: string;
    codeLastFour: string;
    boundEmail: string | null;
    boundAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
    revocationReason: string | null;
    createdAt: Date;
    scheduledSession: { id: string; title: string; language: string; scheduledAt: Date };
}) {
    return {
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
    };
}

const ENTITLEMENT_INCLUDE = {
    scheduledSession: { select: { id: true, title: true, language: true, scheduledAt: true } },
} as const;

/**
 * GET /api/ops/admission?q=<email | last4 | entitlement uuid>
 * Any staff role may look a ticket up — admission support is a facilitator's
 * problem too. Mutations below are the ones that are role-restricted.
 */
export async function GET(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) {
        return error(401, 'unauthenticated', 'Staff authentication required');
    }

    const query = request.nextUrl.searchParams.get('q') ?? '';
    const lookup = classifyLookup(query);
    if (!lookup) {
        return error(400, 'invalid_lookup', 'Provide an email, a code last-four, or an entitlement ID');
    }

    if (lookup.kind === 'id') {
        const entitlement = await prisma.ticketEntitlement.findUnique({
            where: { id: lookup.id },
            include: ENTITLEMENT_INCLUDE,
        });
        if (!entitlement) {
            return error(404, 'not_found', 'No entitlement with that ID');
        }
        return NextResponse.json({ results: [serializeEntitlement(entitlement)] });
    }

    const entitlements = await prisma.ticketEntitlement.findMany({
        where: lookup.kind === 'email'
            ? { boundEmail: lookup.email }
            : { codeLastFour: lookup.last4 },
        include: ENTITLEMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    return NextResponse.json({ results: entitlements.map(serializeEntitlement) });
}

type GenerateBody = { action: 'generate'; sessionId?: string; tier?: string; count?: number };
type ImportBody = { action: 'import'; sessionId?: string; tier?: string; csv?: string };
type CompBody = { action: 'comp'; sessionId?: string; tier?: string; reason?: string };

/**
 * Count entitlements holding a seat right now: everything not revoked. Runs
 * inside the caller's transaction so a concurrent batch cannot overshoot the
 * 150-attendee cap.
 */
async function countActiveEntitlements(
    tx: Pick<typeof prisma, 'ticketEntitlement'>,
    sessionId: string,
): Promise<number> {
    return tx.ticketEntitlement.count({
        where: { scheduledSessionId: sessionId, state: { not: 'REVOKED' } },
    });
}

/**
 * Serialize every seat reservation for one event. A transaction around
 * `count + insert` is not enough at PostgreSQL's default isolation level:
 * concurrent transactions can both observe the same count. This row lock is
 * the shared admission mutex used by paid batches, imports, comps, and support
 * overrides.
 */
async function lockScheduledSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
): Promise<void> {
    await tx.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "scheduled_sessions"
            WHERE "id"::text = ${sessionId}
            FOR UPDATE
        `,
    );
}

async function handleGenerate(staff: StaffPrincipal, body: GenerateBody) {
    if (!hasStaffCapability(staff.role, 'manage_ticket_batches')) {
        return error(403, 'forbidden', 'Your role may not generate ticket batches');
    }
    const { sessionId, tier } = body;
    const count = body.count;
    if (!sessionId || !tier || !GENERATABLE_TIERS.includes(tier as typeof GENERATABLE_TIERS[number])) {
        return error(400, 'invalid_request', 'generate requires sessionId and a paid tier');
    }
    if (!Number.isSafeInteger(count) || count! < 1 || count! > MAX_BATCH_COUNT) {
        return error(400, 'invalid_count', `count must be an integer between 1 and ${MAX_BATCH_COUNT}`);
    }

    const codes = generateTicketCodes(count!);

    const result = await prisma.$transaction(async (tx) => {
        await lockScheduledSession(tx, sessionId);
        const session = await tx.scheduledSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            return { status: 404 as const };
        }

        const active = await countActiveEntitlements(tx, sessionId);
        if (batchExceedsCap(session.attendeeCap, active, codes.length)) {
            return { status: 409 as const, active, cap: session.attendeeCap };
        }

        const expiresAt = ticketExpiresAt(session.scheduledAt);
        await tx.ticketEntitlement.createMany({
            data: codes.map((code) => ({
                scheduledSessionId: sessionId,
                ...ticketCodeStorage(code),
                tier: tier as 'GLOBAL_NORTH' | 'GLOBAL_SOUTH',
                expiresAt,
                issuedByUserId: staff.id,
            })),
        });
        return { status: 201 as const, title: session.title };
    });

    if (result.status === 404) {
        return error(404, 'not_found', 'No scheduled session with that ID');
    }
    if (result.status === 409) {
        return error(409, 'cap_exceeded', `Batch would exceed the attendee cap (${result.active}/${result.cap} seats held)`);
    }

    await recordAuditEvent({
        actorUserId: staff.id,
        actorRole: staff.role,
        action: 'ticket.batch_generate',
        targetType: 'SCHEDULED_SESSION',
        targetId: sessionId,
        metadata: { tier, count: codes.length },
    });

    // The one-time export: plaintext codes leave the server only in this body.
    return NextResponse.json(
        { csv: buildTicketCsv(codes.map((code) => ({ code, tier, eventTitle: result.title, urlPrefix: loginUrlPrefix() }))) },
        { status: 201 },
    );
}

async function handleImport(staff: StaffPrincipal, body: ImportBody) {
    if (!hasStaffCapability(staff.role, 'manage_ticket_batches')) {
        return error(403, 'forbidden', 'Your role may not import ticket batches');
    }
    const { sessionId, tier, csv } = body;
    if (!sessionId || !tier || !GENERATABLE_TIERS.includes(tier as typeof GENERATABLE_TIERS[number]) || !csv) {
        return error(400, 'invalid_request', 'import requires sessionId, a paid tier, and csv text');
    }

    let codes: string[];
    try {
        codes = [...new Set(parseTicketCsv(csv))];
    } catch (parseError) {
        return error(400, 'invalid_csv', parseError instanceof Error ? parseError.message : 'Invalid CSV');
    }
    const candidates = codes.map((code) => ticketCodeStorage(code));

    const result = await prisma.$transaction(async (tx) => {
        await lockScheduledSession(tx, sessionId);
        const session = await tx.scheduledSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            return { status: 404 as const };
        }

        const existing = await tx.ticketEntitlement.findMany({
            where: {
                codeDigest: {
                    in: candidates.map(({ codeDigest }) => codeDigest),
                },
            },
            select: { codeDigest: true },
        });
        const existingDigests = new Set(existing.map(({ codeDigest }) => codeDigest));
        const novel = candidates.filter(
            ({ codeDigest }) => !existingDigests.has(codeDigest),
        );
        const active = await countActiveEntitlements(tx, sessionId);
        if (batchExceedsCap(session.attendeeCap, active, novel.length)) {
            return { status: 409 as const, active, cap: session.attendeeCap };
        }

        const expiresAt = ticketExpiresAt(session.scheduledAt);
        // Idempotent: a digest already present (a rerun of the same import, or
        // overlap with an earlier batch) is skipped, never duplicated.
        const created = novel.length === 0
            ? { count: 0 }
            : await tx.ticketEntitlement.createMany({
                data: novel.map((storage) => ({
                    scheduledSessionId: sessionId,
                    ...storage,
                    tier: tier as 'GLOBAL_NORTH' | 'GLOBAL_SOUTH',
                    expiresAt,
                    issuedByUserId: staff.id,
                })),
                skipDuplicates: true,
            });
        return { status: 201 as const, created: created.count, title: session.title };
    });

    if (result.status === 404) {
        return error(404, 'not_found', 'No scheduled session with that ID');
    }
    if (result.status === 409) {
        return error(409, 'cap_exceeded', `Import would exceed the attendee cap (${result.active}/${result.cap} seats held)`);
    }

    await recordAuditEvent({
        actorUserId: staff.id,
        actorRole: staff.role,
        action: 'ticket.batch_import',
        targetType: 'SCHEDULED_SESSION',
        targetId: sessionId,
        metadata: { tier, count: result.created, skipped: codes.length - result.created },
    });

    return NextResponse.json({ created: result.created, skipped: codes.length - result.created }, { status: 201 });
}

async function handleComp(staff: StaffPrincipal, body: CompBody) {
    const { sessionId, tier, reason } = body;
    if (!sessionId || !tier || !COMP_TIERS.includes(tier as typeof COMP_TIERS[number])) {
        return error(400, 'invalid_request', 'comp requires sessionId and tier COMP or SUPPORT_OVERRIDE');
    }
    if (!reason?.trim()) {
        return error(400, 'reason_required', 'A non-PII reason is required for comp/override issuance');
    }
    const allowed = tier === 'COMP'
        ? hasStaffCapability(staff.role, 'issue_comp')
        : hasStaffCapability(staff.role, 'issue_support_override');
    if (!allowed) {
        return error(403, 'forbidden', 'Your role may not issue this entitlement tier');
    }

    const [code] = generateTicketCodes(1);

    const result = await prisma.$transaction(async (tx) => {
        await lockScheduledSession(tx, sessionId);
        const session = await tx.scheduledSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            return { status: 404 as const };
        }

        // A comp/override consumes one of the event's 150 attendee slots.
        const active = await countActiveEntitlements(tx, sessionId);
        if (batchExceedsCap(session.attendeeCap, active, 1)) {
            return { status: 409 as const, active, cap: session.attendeeCap };
        }

        const entitlement = await tx.ticketEntitlement.create({
            data: {
                scheduledSessionId: sessionId,
                ...ticketCodeStorage(code),
                // Scoped to this one event, expires after it (plus the support
                // window), and — like every entitlement — grants no publish
                // permission; stage grants are a separate WS3 control.
                tier: tier as 'COMP' | 'SUPPORT_OVERRIDE',
                expiresAt: ticketExpiresAt(session.scheduledAt),
                issuedByUserId: staff.id,
            },
        });
        return { status: 201 as const, id: entitlement.id, title: session.title };
    });

    if (result.status === 404) {
        return error(404, 'not_found', 'No scheduled session with that ID');
    }
    if (result.status === 409) {
        return error(409, 'cap_exceeded', `The event is at its attendee cap (${result.active}/${result.cap})`);
    }

    await recordAuditEvent({
        actorUserId: staff.id,
        actorRole: staff.role,
        action: 'ticket.comp_issue',
        targetType: 'TICKET_ENTITLEMENT',
        targetId: result.id,
        reason: reason.trim(),
        metadata: { tier },
    });

    return NextResponse.json(
        { id: result.id, csv: buildTicketCsv([{ code, tier, eventTitle: result.title, urlPrefix: loginUrlPrefix() }]) },
        { status: 201 },
    );
}

export async function POST(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) {
        return error(401, 'unauthenticated', 'Staff authentication required');
    }

    let body: GenerateBody | ImportBody | CompBody;
    try {
        body = await request.json();
    } catch {
        return error(400, 'invalid_request', 'Request body must be JSON');
    }

    switch (body.action) {
        case 'generate':
            return handleGenerate(staff, body);
        case 'import':
            return handleImport(staff, body);
        case 'comp':
            return handleComp(staff, body);
        default:
            return error(400, 'invalid_request', 'action must be generate, import, or comp');
    }
}
