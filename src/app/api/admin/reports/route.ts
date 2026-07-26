import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const STATUSES = ['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED'] as const;
type ReportStatusValue = (typeof STATUSES)[number];

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * GET /api/admin/reports?status=OPEN&limit=50
 * The triage queue. ADMIN only.
 *
 * Ordered oldest first: the queue exists to be worked down against the 24h
 * acknowledgement commitment in BUSINESS_RULES.md §10, and newest-first ordering
 * buries exactly the reports closest to breaching it.
 */
export async function GET(request: NextRequest) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limitParam = searchParams.get('limit');

    if (status !== null && !STATUSES.includes(status as ReportStatusValue)) {
        return NextResponse.json(
            { error: `status must be one of ${STATUSES.join(', ')}` },
            { status: 400 },
        );
    }

    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
        const parsed = Number.parseInt(limitParam, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
        }
        limit = Math.min(parsed, MAX_LIMIT);
    }

    try {
        const reports = await prisma.report.findMany({
            where: status ? { status: status as ReportStatusValue } : {},
            orderBy: { createdAt: 'asc' },
            take: limit,
            select: {
                id: true,
                targetType: true,
                targetId: true,
                reason: true,
                detail: true,
                status: true,
                resolution: true,
                acknowledgedAt: true,
                resolvedAt: true,
                createdAt: true,
                // The reporter may be an anonymised row by now
                // (src/app/api/users/me/route.ts) or null after a hard delete;
                // either way the report itself stays actionable.
                reporter: { select: { id: true, name: true, email: true } },
                handledBy: { select: { id: true, name: true, email: true } },
            },
        });

        const counts = await prisma.report.groupBy({
            by: ['status'],
            _count: { _all: true },
        });

        return NextResponse.json({
            reports: reports.map((r) => ({
                ...r,
                acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
                resolvedAt: r.resolvedAt?.toISOString() ?? null,
                createdAt: r.createdAt.toISOString(),
            })),
            counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        });
    } catch (error) {
        console.error('Failed to list reports:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to list reports' }, { status: 500 });
    }
}
