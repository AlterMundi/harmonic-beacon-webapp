import { NextRequest, NextResponse } from 'next/server';

import {
    accountConfiguration,
    beaconAccountEnabled,
    revokeCentralSession,
    verifyAccountFrontchannelLogoutToken,
} from '@/lib/account-rp';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!beaconAccountEnabled()) {
        return new NextResponse(null, { status: 404 });
    }
    const token = request.nextUrl.searchParams.get('logout_token') ?? '';
    try {
        const config = accountConfiguration();
        const authority = verifyAccountFrontchannelLogoutToken(token, config);
        if (!authority) {
            return new NextResponse(null, {
                status: 400,
                headers: { 'Cache-Control': 'private, no-store' },
            });
        }
        await revokeCentralSession(authority.iss, authority.sid);
        return new NextResponse('<!doctype html><title>Signed out</title>', {
            status: 200,
            headers: {
                'Cache-Control': 'private, no-store',
                'Content-Security-Policy': `default-src 'none'; frame-ancestors ${new URL(config.issuer).origin}`,
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
