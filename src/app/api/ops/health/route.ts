import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { collectOperatorHealth } from '@/lib/ops-health';

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
export async function GET() {
    // Every staff role may watch the board: Julián on stage and both
    // operators need the same picture during the event.
    const [staff, errorResponse] = await requireStaff('ADMIN', 'OPERATOR', 'FACILITATOR');
    if (!staff) {
        return errorResponse;
    }

    const report = await collectOperatorHealth();
    return NextResponse.json(report);
}
