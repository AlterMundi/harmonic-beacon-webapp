import { NextRequest, NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { tapestryInternalUrl } from '@/lib/tapestry';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

/**
 * Staff side of the tapestry arrangement (WS3-02 follow-up, issue #53).
 * Lists the active tiles in display order and persists the staff-set
 * arrangement. Both proxy to the internal tapestry service with the shared
 * secret; the facilitator scoping matches the stage route.
 */

async function resolveStaffSession(id: string) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) {
        return { error: errorResponse };
    }
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: { facilitatorId: true },
    });
    if (!scheduledSession) {
        return { error: NextResponse.json({ error: 'session_not_found' }, { status: 404 }) };
    }
    if (!eventStaffPolicy(
        staff.role,
        scheduledSession.facilitatorId === staff.userId,
    ).canOperateEvent) {
        return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
    }
    return { staff };
}

function unavailable() {
    return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
}

/** Active tile ids in display order (the ops arrange UI fetches tiles separately). */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { error } = await resolveStaffSession(id);
    if (error) {
        return error;
    }
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl) {
        return unavailable();
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(id)}/participants`,
            {
                headers: { 'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET! },
                cache: 'no-store',
                signal: AbortSignal.timeout(3_000),
            },
        );
        if (!response.ok) {
            return NextResponse.json({ error: 'Tapestry unavailable' }, { status: response.status === 404 ? 404 : 502 });
        }
        return NextResponse.json(await response.json(), {
            headers: { 'cache-control': 'private, no-store' },
        });
    } catch {
        return unavailable();
    }
}

/** Persist a staff arrangement: {"order": string[]} of tile ids. */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { error } = await resolveStaffSession(id);
    if (error) {
        return error;
    }
    let body: { order?: unknown };
    try {
        body = await request.json() as { order?: unknown };
    } catch {
        return NextResponse.json({ error: 'A JSON request body is required' }, { status: 400 });
    }
    if (
        !Array.isArray(body.order) ||
        body.order.some((pid) => typeof pid !== 'string' || !pid.trim()) ||
        new Set(body.order).size !== body.order.length
    ) {
        return NextResponse.json({ error: 'invalid_order' }, { status: 400 });
    }
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl) {
        return unavailable();
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(id)}/order`,
            {
                method: 'PUT',
                headers: {
                    'content-type': 'application/json',
                    'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET!,
                },
                body: JSON.stringify({ order: body.order }),
                cache: 'no-store',
                signal: AbortSignal.timeout(3_000),
            },
        );
        if (!response.ok) {
            return NextResponse.json({ error: 'Tapestry unavailable' }, { status: response.status === 404 ? 404 : 502 });
        }
        return NextResponse.json(await response.json());
    } catch {
        return unavailable();
    }
}
