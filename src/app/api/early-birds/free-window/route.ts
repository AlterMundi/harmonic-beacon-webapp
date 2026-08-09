import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

function retired(_request?: unknown): NextResponse {
    void _request;
    return NextResponse.json({
        error: 'Free listening schedules were replaced by the personal weekly quota.',
        reason: 'quota_policy_replaced',
    }, { status: 410, headers: PRIVATE_HEADERS });
}

export const GET = retired;
export const POST = retired;
