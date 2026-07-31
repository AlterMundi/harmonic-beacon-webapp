import { NextRequest, NextResponse } from 'next/server';

import { resolveStaffSession } from '@/lib/ops-auth';
import {
    SessionLifecycleError,
    transitionScheduledSession,
    type LifecycleTargetStatus,
} from '@/lib/session-lifecycle';

export const dynamic = 'force-dynamic';

const TARGETS = new Set<LifecycleTargetStatus>(['LIVE', 'ENDED', 'CANCELLED']);

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const staff = await resolveStaffSession(request);
    if (!staff) {
        return NextResponse.json(
            { error: 'unauthenticated', message: 'Staff authentication required' },
            { status: 401 },
        );
    }

    const body = await request.json().catch(() => null) as {
        status?: unknown;
        reason?: unknown;
    } | null;
    if (!body || typeof body.status !== 'string' || !TARGETS.has(body.status as LifecycleTargetStatus)) {
        return NextResponse.json(
            { error: 'invalid_request', message: 'status must be LIVE, ENDED, or CANCELLED' },
            { status: 400 },
        );
    }
    if (body.reason !== undefined && typeof body.reason !== 'string') {
        return NextResponse.json(
            { error: 'invalid_request', message: 'reason must be text' },
            { status: 400 },
        );
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;
    if (reason && (reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason))) {
        return NextResponse.json(
            { error: 'invalid_reason', message: 'reason must be 240 printable characters or fewer and contain no attendee details' },
            { status: 400 },
        );
    }

    const { id } = await params;
    try {
        const result = await transitionScheduledSession({
            sessionId: id,
            actor: staff,
            targetStatus: body.status as LifecycleTargetStatus,
            reason,
        });
        return NextResponse.json({
            ...result,
            startedAt: result.startedAt?.toISOString() ?? null,
            endedAt: result.endedAt?.toISOString() ?? null,
        });
    } catch (error) {
        if (error instanceof SessionLifecycleError) {
            return NextResponse.json(
                { error: error.code, message: error.message },
                { status: error.status },
            );
        }
        console.error('[lifecycle] transition failed');
        return NextResponse.json(
            { error: 'lifecycle_unavailable', message: 'The event status could not be changed' },
            { status: 500 },
        );
    }
}
