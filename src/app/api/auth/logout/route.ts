/**
 * Logout: revoke the session row, clear the cookie.
 *
 * Revoking server-side matters more here than clearing the cookie. An attendee
 * who logs out on a borrowed phone has to be logged out even if the cookie
 * survives, because the cookie alone is the credential — and the same
 * `revokedAt` column an operator uses to cut off a session is what makes that
 * true for the holder as well.
 *
 * Always answers 200 with a cleared cookie, whether or not the token was real.
 * Distinguishing the two would let an attacker test session tokens here.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clearedSessionCookie, revokeWebSessionByToken } from '@/lib/principal';
import { redactError } from '@/lib/redact';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    try {
        await revokeWebSessionByToken(token);
    } catch (error) {
        // The cookie still gets cleared: a database blip must not leave someone
        // apparently signed in on a device they are walking away from.
        console.error(`[auth] logout could not revoke the session row: ${redactError(error)}`);
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(clearedSessionCookie());
    return response;
}
