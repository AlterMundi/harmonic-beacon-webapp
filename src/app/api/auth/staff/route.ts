/**
 * Staff login: seeded email + password.
 *
 * Four named people, credentials seeded from environment-supplied scrypt
 * digests (see `prisma/seed-contract.ts`). No signup, no reset, no MFA, no
 * recovery — a lost credential is re-seeded by the operator who holds the
 * secrets. Everything else about the session is identical to an attendee's:
 * same opaque `hb_session` cookie, same database-resolved authority.
 */

import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { clientAddress } from '@/lib/client-address';
import {
    isPlausibleEmail,
    newSessionToken,
    normalizeLoginEmail,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';
import { authFailureLimiter } from '@/lib/rate-limit';
import { redactError } from '@/lib/redact';
import { verifyStaffPassword } from '@/lib/session-auth';

const GENERIC_REJECTION = 'Those credentials are not valid.';
const RATE_LIMITED = 'Too many attempts. Please wait and try again.';
const MALFORMED_REQUEST = 'An email address and a password are required.';

/**
 * A real scrypt digest of nothing, verified against when no account matches, so
 * an unknown address costs the same key derivation as a known one. Without it
 * the response time alone enumerates which of the four staff addresses exist.
 */
const DECOY_DIGEST = `scrypt$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`;

type FailureReason = 'malformed_request' | 'unknown_account' | 'bad_password' | 'disabled_account';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const address = clientAddress(request.headers);

    if (authFailureLimiter.isLimited(address)) {
        console.warn(`[auth] staff login rate limited: client=${address}`);
        return NextResponse.json({ error: RATE_LIMITED }, {
            status: 429,
            headers: { 'Retry-After': String(authFailureLimiter.retryAfterSeconds(address)) },
        });
    }

    let loginEmail: string;
    let password: string;
    try {
        const body = (await request.json()) as unknown;
        const fields = (body ?? {}) as Record<string, unknown>;
        loginEmail = typeof fields.email === 'string' ? normalizeLoginEmail(fields.email) : '';
        password = typeof fields.password === 'string' ? fields.password : '';
    } catch {
        loginEmail = '';
        password = '';
    }

    if (!isPlausibleEmail(loginEmail) || password.length === 0) {
        return reject(address, 'malformed_request');
    }

    try {
        const staff = await prisma.user.findUnique({
            where: { email: loginEmail },
            select: { id: true, role: true, passwordDigest: true, disabledAt: true },
        });

        const digest = staff?.passwordDigest ?? DECOY_DIGEST;
        const passwordMatches = await verifyStaffPassword(password, digest);

        if (!staff) {
            return reject(address, 'unknown_account');
        }
        if (!passwordMatches) {
            return reject(address, 'bad_password');
        }
        // Checked after the password so a disabled account is not distinguishable
        // from a wrong password by anyone who does not already hold the credential.
        if (staff.disabledAt !== null) {
            return reject(address, 'disabled_account');
        }

        const now = new Date();
        const issued = newSessionToken();
        await prisma.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                staffUserId: staff.id,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });

        console.info(`[auth] staff session issued: user=${staff.id} role=${staff.role} client=${address}`);

        const response = NextResponse.json({ ok: true, role: staff.role });
        response.cookies.set(sessionCookie(issued.cookieValue, now));
        return response;
    } catch (error) {
        console.error(`[auth] staff login failed: client=${address} ${redactError(error)}`);
        return NextResponse.json({ error: 'Login is temporarily unavailable.' }, { status: 500 });
    }
}

function reject(address: string, reason: FailureReason): NextResponse {
    authFailureLimiter.recordFailure(address);
    console.warn(`[auth] staff login rejected: reason=${reason} client=${address}`);
    return NextResponse.json(
        { error: reason === 'malformed_request' ? MALFORMED_REQUEST : GENERIC_REJECTION },
        { status: reason === 'malformed_request' ? 400 : 401 },
    );
}
