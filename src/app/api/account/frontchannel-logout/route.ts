import { NextRequest, NextResponse } from 'next/server';

import {
    accountConfiguration,
    beaconAccountEnabled,
    revokeCentralSession,
} from '@/lib/account-rp';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!beaconAccountEnabled()) {
        return new NextResponse(null, { status: 404 });
    }
    const issuer = request.nextUrl.searchParams.get('iss') ?? '';
    const sid = request.nextUrl.searchParams.get('sid') ?? '';
    try {
        const expectedIssuer = accountConfiguration().issuer;
        await revokeCentralSession(issuer, sid);
        return new NextResponse('<!doctype html><title>Signed out</title>', {
            status: 200,
            headers: {
                'Cache-Control': 'private, no-store',
                'Content-Security-Policy': `default-src 'none'; frame-ancestors ${new URL(expectedIssuer).origin}`,
                'Content-Type': 'text/html; charset=utf-8',
                'Referrer-Policy': 'no-referrer',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        console.error(`[account] front-channel logout failed: ${redactError(error)}`);
        return new NextResponse(null, {
            status: 503,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
}
