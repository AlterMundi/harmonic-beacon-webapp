import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
    EarlyBirdMembershipContractError,
    parseMembershipProjectionCommand,
} from '@/lib/early-birds/membership-contract';
import {
    applyMembershipProjection,
    EarlyBirdProjectionConflictError,
    membershipAccessDecision,
    type EarlyBirdProjectionOutcome,
} from '@/lib/early-birds/membership';
import { authorizeEarlyBirdMembershipService } from '@/lib/early-birds/service-auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function response(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

function authorized(request: NextRequest): boolean {
    return authorizeEarlyBirdMembershipService(
        request.headers.get('authorization'),
        request.headers.get('x-hb-service-key-id'),
    );
}

function result(
    projection: NonNullable<ReturnType<typeof membershipAccessDecision>['projection']>,
    outcome: EarlyBirdProjectionOutcome,
) {
    return {
        schema_version: 'early-bird-membership.result.v1',
        membership_id: projection.id,
        account_id: projection.accountId,
        outcome,
        applied_revision: projection.revision,
        effective_state: projection.state,
        access_allowed: membershipAccessDecision(projection).allowed,
        reconciliation_required: false,
    };
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
    if (!authorized(request)) return response({ error: 'Service authentication failed.' }, 401);
    const { accountId } = await params;
    if (!accountId || accountId.length > 255) return response({ error: 'Resource not found.' }, 404);
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return response({ error: 'Content-Type must be application/json.' }, 400);
    }
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return response({ error: 'Request body exceeds 16 KiB.' }, 413);
    }

    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return response({ error: 'Malformed request.' }, 400);
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return response({ error: 'Request body exceeds 16 KiB.' }, 413);
    }

    try {
        const command = parseMembershipProjectionCommand(JSON.parse(raw) as unknown);
        if (command.account_id !== accountId) return response({ error: 'Account mismatch.' }, 422);
        const expectedKey = `early-bird-membership:${accountId}:${command.membership_revision}`;
        if (request.headers.get('idempotency-key') !== expectedKey) {
            return response({ error: 'Idempotency-Key mismatch.' }, 422);
        }
        const applied = await applyMembershipProjection(command);
        return response(result(applied.projection, applied.outcome));
    } catch (error) {
        if (error instanceof SyntaxError) return response({ error: 'Malformed request.' }, 400);
        if (error instanceof EarlyBirdMembershipContractError) return response({ error: error.message }, 422);
        if (error instanceof EarlyBirdProjectionConflictError) {
            return response({ error: 'Revision conflicts with the existing command.' }, 409);
        }
        console.error('[early-bird-membership] apply failed without request material');
        return response({ error: 'Membership projection unavailable.' }, 500);
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
    if (!authorized(request)) return response({ error: 'Service authentication failed.' }, 401);
    const { accountId } = await params;
    if (!accountId || accountId.length > 255) return response({ error: 'Resource not found.' }, 404);
    try {
        const projection = await prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
        return projection ? response(result(projection, 'REPLAYED')) : response({ error: 'Resource not found.' }, 404);
    } catch {
        console.error('[early-bird-membership] reconciliation read failed');
        return response({ error: 'Membership projection unavailable.' }, 500);
    }
}
