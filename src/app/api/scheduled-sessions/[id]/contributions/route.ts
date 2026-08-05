import { NextRequest, NextResponse } from 'next/server';

import {
    ContributionError,
    createContribution,
    decodeContributionCursor,
    listPublicContributions,
    parseContributionsPageLimit,
} from '@/lib/session-contributions';
import { resolveRoomViewer } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';

/**
 * CHAT-01 (#137): the public questions-and-emotions feed and its submission
 * endpoint. `resolveRoomViewer` is the same read-only entitlement gate the
 * polling sidecars use: only this event's ticket holder or authorized staff
 * reach the data, and no GET performs a write. Identity is never taken from
 * the request body — the server resolves it from the authenticated session.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

async function resolveViewer(request: NextRequest, sessionId: string) {
    const entitlement = await resolveRoomViewer(request, sessionId);
    if (!entitlement.ok) {
        return {
            error: NextResponse.json(
                { error: entitlement.error },
                { status: entitlement.status },
            ),
        };
    }
    return { principal: entitlement.principal };
}

function contributionErrorResponse(error: unknown): NextResponse {
    if (error instanceof ContributionError) {
        const headers: Record<string, string> = {};
        if (error.status === 429 && typeof error.details?.retryAfterSeconds === 'number') {
            headers['Retry-After'] = String(error.details.retryAfterSeconds);
        }
        return NextResponse.json(
            {
                error: error.code,
                message: error.message,
                ...error.details,
            },
            { status: error.status, headers },
        );
    }
    // Static message only: the underlying error may carry query detail with
    // user data, and stdout leaves the host.
    console.error('[contributions] unexpected contribution failure');
    return NextResponse.json(
        { error: 'contributions_unavailable' },
        { status: 500 },
    );
}

/**
 * Bounded public feed, newest page forward in stable (createdAt, id) order.
 * Only VISIBLE contributions; HIDDEN/WITHDRAWN transitions belong to CHAT-02
 * and never revive here. Suggested client poll: 5 seconds.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveViewer(request, id);
    if (!principal) {
        return error;
    }
    try {
        const searchParams = request.nextUrl.searchParams;
        const page = await listPublicContributions({
            scheduledSessionId: id,
            cursor: decodeContributionCursor(searchParams.get('cursor')),
            limit: parseContributionsPageLimit(searchParams.get('limit')),
        });
        return NextResponse.json(page, { headers: NO_STORE });
    } catch (failure) {
        return contributionErrorResponse(failure);
    }
}

/**
 * Publish one contribution. Attendees only: staff observe and moderate from
 * the ops console, they do not post into the audience feed. The client sends
 * body, visibility and an idempotency key — never identity.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveViewer(request, id);
    if (!principal) {
        return error;
    }
    if (!principal.ticketEntitlementId) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 },
        );
    }

    let payload: { body?: unknown; visibility?: unknown; idempotencyKey?: unknown };
    try {
        payload = await request.json() as typeof payload;
    } catch {
        return NextResponse.json(
            { error: 'invalid_request', message: 'A JSON request body is required' },
            { status: 400 },
        );
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return NextResponse.json(
            { error: 'invalid_request', message: 'A JSON object body is required' },
            { status: 400 },
        );
    }

    try {
        const result = await createContribution({
            scheduledSessionId: id,
            ticketEntitlementId: principal.ticketEntitlementId,
            displayName: principal.displayName,
            body: payload.body,
            visibility: payload.visibility,
            idempotencyKey: payload.idempotencyKey,
        });
        return NextResponse.json(result.contribution, {
            status: result.created ? 201 : 200,
            headers: NO_STORE,
        });
    } catch (failure) {
        return contributionErrorResponse(failure);
    }
}
