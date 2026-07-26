import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

const TARGET_TYPES = ['MEDITATION', 'SESSION', 'USER'] as const;
const REASONS = ['SAFETY', 'THERAPEUTIC_CLAIM', 'COPYRIGHT', 'SPAM', 'OTHER'] as const;

type TargetType = (typeof TARGET_TYPES)[number];
type Reason = (typeof REASONS)[number];

/** Free-form context is capped so a report cannot be used as a storage channel. */
const MAX_DETAIL_LENGTH = 4000;

/**
 * POST /api/reports
 * File a safety or policy report. Any authenticated user.
 * Body: { targetType, targetId, reason, detail? }
 *
 * BUSINESS_RULES.md §10 / TRUST_AND_SAFETY.md §2.5. The playbook at §5.1 begins
 * with "a report arrives"; this is the route that makes that possible.
 */
export async function POST(request: NextRequest) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { targetType, targetId, reason, detail } = body as {
        targetType?: string;
        targetId?: string;
        reason?: string;
        detail?: string;
    };

    if (!targetType || !TARGET_TYPES.includes(targetType as TargetType)) {
        return NextResponse.json(
            { error: `targetType must be one of ${TARGET_TYPES.join(', ')}` },
            { status: 400 },
        );
    }

    if (!targetId || typeof targetId !== 'string') {
        return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
    }

    if (!reason || !REASONS.includes(reason as Reason)) {
        return NextResponse.json(
            { error: `reason must be one of ${REASONS.join(', ')}` },
            { status: 400 },
        );
    }

    if (detail !== undefined && typeof detail !== 'string') {
        return NextResponse.json({ error: 'detail must be a string' }, { status: 400 });
    }

    if (typeof detail === 'string' && detail.length > MAX_DETAIL_LENGTH) {
        return NextResponse.json(
            { error: `detail must be ${MAX_DETAIL_LENGTH} characters or fewer` },
            { status: 400 },
        );
    }

    try {
        const user = await prisma.user.findUnique({
            where: { zitadelId: session.user.id },
            select: { id: true },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (!(await targetExists(targetType as TargetType, targetId))) {
            return NextResponse.json({ error: 'Report target not found' }, { status: 404 });
        }

        // There is no rate limiting anywhere in this application, so this is the
        // cheap half of the same protection: one reporter cannot stack open
        // reports on one target. It bounds the queue against the most likely
        // accidental flood (a frustrated user clicking Report repeatedly) without
        // pretending to be a defence against a determined one. A real limiter is
        // still owed — see TRUST_AND_SAFETY.md §2.1.
        const existing = await prisma.report.findFirst({
            where: {
                reporterId: user.id,
                targetType: targetType as TargetType,
                targetId,
                status: 'OPEN',
            },
            select: { id: true },
        });

        if (existing) {
            return NextResponse.json(
                {
                    error: 'You already have an open report against this target',
                    reportId: existing.id,
                },
                { status: 409 },
            );
        }

        const report = await prisma.report.create({
            data: {
                reporterId: user.id,
                targetType: targetType as TargetType,
                targetId,
                reason: reason as Reason,
                detail: detail || null,
            },
            select: { id: true, status: true, createdAt: true },
        });

        return NextResponse.json(
            {
                report: {
                    id: report.id,
                    status: report.status,
                    createdAt: report.createdAt.toISOString(),
                },
            },
            { status: 201 },
        );
    } catch (error) {
        console.error('Failed to file report:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to file report' }, { status: 500 });
    }
}

/**
 * Reject a report against something that does not exist.
 *
 * Not a security control — the reporter learns nothing they could not learn from
 * the surface they clicked Report on. It keeps the triage queue meaningful: an
 * Admin working through OPEN reports should not spend the 24h acknowledgement
 * window on rows pointing at nothing.
 */
async function targetExists(targetType: TargetType, targetId: string): Promise<boolean> {
    switch (targetType) {
        case 'MEDITATION':
            return (await prisma.meditation.count({ where: { id: targetId } })) > 0;
        case 'SESSION':
            return (await prisma.scheduledSession.count({ where: { id: targetId } })) > 0;
        case 'USER':
            return (await prisma.user.count({ where: { id: targetId } })) > 0;
    }
}
