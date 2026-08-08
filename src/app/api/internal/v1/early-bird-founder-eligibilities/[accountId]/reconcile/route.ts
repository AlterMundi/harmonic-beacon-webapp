import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
    applyFounderEligibilityProjection,
    FounderEligibilityAccountNotFoundError,
    FounderEligibilityConflictError,
} from '@/lib/early-birds/founder-eligibility';
import {
    earlyBirdMembershipReader,
    EarlyBirdMembershipGatewayUnavailableError,
} from '@/lib/early-birds/membership-gateway';
import { isEarlyBirdAccountId } from '@/lib/early-birds/account-id';
import { authorizeEarlyBirdMembershipService } from '@/lib/early-birds/service-auth';

export const dynamic = 'force-dynamic';

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

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
    if (!authorized(request)) return response({ error: 'Service authentication failed.' }, 401);
    const { accountId } = await params;
    if (!isEarlyBirdAccountId(accountId)) return response({ error: 'Resource not found.' }, 404);

    try {
        const account = await prisma.earlyBirdUser.findUnique({
            where: { id: accountId },
            select: { id: true },
        });
        if (!account) return response({ error: 'Resource not found.' }, 404);
    } catch {
        console.error('[founder-eligibility] local account lookup failed');
        return response({ error: 'Founder eligibility reconciliation unavailable.' }, 500);
    }

    let canonical;
    try {
        canonical = await earlyBirdMembershipReader().readMembership(accountId);
    } catch (error) {
        if (!(error instanceof EarlyBirdMembershipGatewayUnavailableError)) {
            console.error('[founder-eligibility] unexpected authority read failure');
        }
        return response({ error: 'Founder eligibility authority unavailable.' }, 503);
    }
    if (!canonical.ok) {
        return response({ error: 'Founder eligibility reconciliation conflict.' }, 409);
    }

    try {
        const outcome = await applyFounderEligibilityProjection(
            accountId,
            canonical.membership.founder_price_eligibility,
        );
        return response({
            schema_version: 'listener-founder-eligibility-reconciliation.result.v1',
            outcome,
            founder_price_eligible: canonical.membership.founder_price_eligibility !== null,
        });
    } catch (error) {
        if (error instanceof FounderEligibilityAccountNotFoundError) {
            return response({ error: 'Resource not found.' }, 404);
        }
        if (error instanceof FounderEligibilityConflictError) {
            return response({ error: 'Founder eligibility reconciliation conflict.' }, 409);
        }
        console.error('[founder-eligibility] projection failed without authority material');
        return response({ error: 'Founder eligibility reconciliation unavailable.' }, 500);
    }
}
