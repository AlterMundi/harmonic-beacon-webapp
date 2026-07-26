import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const STATUSES = ['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED'] as const;
type ReportStatusValue = (typeof STATUSES)[number];

/** Statuses that close a report. */
const TERMINAL_STATUSES: ReportStatusValue[] = ['RESOLVED', 'DISMISSED'];

const MAX_RESOLUTION_LENGTH = 4000;

/**
 * PATCH /api/admin/reports/[id]
 * Triage a report. ADMIN only.
 * Body: { status, resolution? }
 *
 * `acknowledgedAt` is stamped the first time a report leaves OPEN. That makes the
 * 24-hour acknowledgement commitment in BUSINESS_RULES.md §10 *measurable* —
 * nothing here enforces it, nothing notifies anyone, and no timer runs. Measurable
 * is the deliverable; the doc is explicit that the response times should not
 * appear on a public surface until a queue measures them, and this is that queue.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    const { id } = await params;

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { status, resolution } = body as { status?: string; resolution?: string };

    if (!status || !STATUSES.includes(status as ReportStatusValue)) {
        return NextResponse.json(
            { error: `status must be one of ${STATUSES.join(', ')}` },
            { status: 400 },
        );
    }

    if (resolution !== undefined && typeof resolution !== 'string') {
        return NextResponse.json({ error: 'resolution must be a string' }, { status: 400 });
    }

    if (typeof resolution === 'string' && resolution.length > MAX_RESOLUTION_LENGTH) {
        return NextResponse.json(
            { error: `resolution must be ${MAX_RESOLUTION_LENGTH} characters or fewer` },
            { status: 400 },
        );
    }

    const nextStatus = status as ReportStatusValue;

    try {
        const report = await prisma.report.findUnique({
            where: { id },
            select: { id: true, status: true, acknowledgedAt: true, resolvedAt: true },
        });

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        const admin = await prisma.user.findUnique({
            where: { zitadelId: session.user.id },
            select: { id: true },
        });

        if (!admin) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const now = new Date();

        // First move off OPEN is the acknowledgement. Never overwritten: an Admin
        // reopening and re-triaging a report does not reset when it was first seen.
        const acknowledgedAt = report.acknowledgedAt
            ?? (nextStatus !== 'OPEN' ? now : null);

        // Cleared when a report is reopened, so `resolvedAt` never claims a report
        // is closed while its status says otherwise.
        const resolvedAt = TERMINAL_STATUSES.includes(nextStatus)
            ? (report.resolvedAt ?? now)
            : null;

        const updated = await prisma.report.update({
            where: { id },
            data: {
                status: nextStatus,
                ...(resolution !== undefined ? { resolution: resolution || null } : {}),
                acknowledgedAt,
                resolvedAt,
                handledById: admin.id,
            },
            select: {
                id: true,
                status: true,
                resolution: true,
                acknowledgedAt: true,
                resolvedAt: true,
            },
        });

        await logAdminAction(session, {
            action: 'report.triage',
            targetType: 'REPORT',
            targetId: id,
            metadata: {
                previousStatus: report.status,
                newStatus: nextStatus,
                acknowledged: acknowledgedAt !== null,
                ...(resolution !== undefined ? { resolution: resolution || null } : {}),
            },
        });

        return NextResponse.json({
            report: {
                ...updated,
                acknowledgedAt: updated.acknowledgedAt?.toISOString() ?? null,
                resolvedAt: updated.resolvedAt?.toISOString() ?? null,
            },
        });
    } catch (error) {
        console.error('Failed to triage report:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to triage report' }, { status: 500 });
    }
}
