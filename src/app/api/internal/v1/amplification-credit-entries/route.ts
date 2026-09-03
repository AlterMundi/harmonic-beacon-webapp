import { NextRequest, NextResponse } from 'next/server';

import {
    AmplificationCreditFeedError,
    listAmplificationCreditEntries,
    parseAmplificationCreditFeedQuery,
} from '@/lib/amplification-credit-feed';
import { authorizeCommerceService } from '@/lib/commerce-service-auth';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

function response(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!authorizeCommerceService(
        request.headers.get('authorization'),
        request.headers.get('x-hb-service-key-id'),
    )) {
        return response({
            error: 'unauthorized',
            message: 'Service authentication failed',
        }, 401);
    }

    try {
        return response(await listAmplificationCreditEntries(
            parseAmplificationCreditFeedQuery(request.nextUrl.searchParams),
        ));
    } catch (error) {
        if (error instanceof AmplificationCreditFeedError) {
            return response({ error: error.code, message: error.message }, error.status);
        }
        console.error('[amplification-credit-feed] feed read failed');
        return response({
            error: 'amplification_credit_feed_unavailable',
            message: 'Beacon could not read amplification credit entries',
        }, 500);
    }
}
