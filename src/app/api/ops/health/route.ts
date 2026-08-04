import { NextRequest, NextResponse } from 'next/server';

import { requireStaffCapability } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { collectOperatorHealth, productionDeps } from '@/lib/ops-health';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/health
 * Operator event health — aggregates Postgres, the LiveKit API, the stage
 * room, the publish-grant invariant, the bed publisher, and the tapestry into
 * one green/yellow/red report for the `/ops/health` dashboard.
 *
 * Staff-only: the report names internal hosts, rooms, and failure detail that
 * an unauthenticated probe must not see. Errors inside the report are already
 * redacted by `@/lib/ops-health`.
 *
 * Always answers 200 when the endpoint itself works; the body carries the
 * health state. A 503 here would mean "the check could not run", not "a
 * subsystem is down" — those are different alarms.
 */
export async function GET(request: NextRequest) {
    // Every staff role may watch the board: Julián on stage and both
    // operators need the same picture during the event.
    const [staff, errorResponse] = await requireStaffCapability('view_operations_health');
    if (!staff) {
        return errorResponse;
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim() || undefined;
    if (sessionId) {
        const session = await prisma.scheduledSession.findUnique({
            where: { id: sessionId },
            select: { facilitatorId: true, status: true },
        });
        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }
        if (!eventStaffPolicy(
            staff.role,
            session.facilitatorId === staff.userId,
        ).canOperateEvent) {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }
        if (session.status !== 'SCHEDULED' && session.status !== 'LIVE') {
            return NextResponse.json(
                { error: 'Health is available for scheduled or live sessions' },
                { status: 409 },
            );
        }
    }

    const report = await collectOperatorHealth(productionDeps({ sessionId }));
    return NextResponse.json(report);
}
