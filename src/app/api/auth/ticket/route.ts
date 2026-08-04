/**
 * Attendee login: ticket code + email.
 *
 * The whole attendee identity model lives in this handler. First successful use
 * binds the ticket to `trim(email).toLowerCase()` inside one transaction with a
 * conditional update, so two people who somehow hold the same code cannot both
 * claim it; every later use — after a refresh, a browser restart, or a dropped
 * connection mid-event — succeeds for that same normalized email and no other.
 *
 * Every failure returns the same status and message. A distinguishable "no such
 * code" would turn this endpoint into a code oracle, and a distinguishable
 * "wrong email" would confirm which address bought a ticket.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { clientAddress } from '@/lib/client-address';
import {
    isPlausibleEmail,
    isValidDisplayName,
    newSessionToken,
    normalizeDisplayName,
    normalizeLoginEmail,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';
import { authFailureLimiter } from '@/lib/rate-limit';
import { redactError } from '@/lib/redact';
import {
    isPlausiblePromoCode,
    promoInvitationsEnabled,
    redeemPromoInvitation,
} from '@/lib/promo-invitation';
import { digestTicketCode, normalizeTicketCode } from '@/lib/ticket-code';

/** One message for every rejection. See the module comment. */
const GENERIC_REJECTION = 'That ticket code and email do not match an active ticket.';
const RATE_LIMITED = 'Too many attempts. Please wait and try again.';
const MALFORMED_REQUEST = 'A display name, ticket code and email address are required.';
const INVITATION_TERMS_VERSION = 'personal-invitation-v2';
const INVITATION_RETURN_URL = 'https://harmonicbeacon.com/invitacion/';
const PUBLIC_APP_ORIGIN = 'https://live.harmonicbeacon.com';

type FailureReason =
    | 'malformed_request'
    | 'unknown_code'
    | 'email_mismatch'
    | 'revoked'
    | 'expired'
    | 'binding_lost'
    | 'promo_unavailable';

type Attempt =
    | { ok: true; scheduledSessionId: string; entitlementId: string; codeLastFour: string; cookieValue: string }
    | { ok: false; reason: FailureReason };

export async function POST(request: NextRequest): Promise<NextResponse> {
    const address = clientAddress(request.headers);
    const isInvitationForm = request.headers.get('content-type')
        ?.toLowerCase()
        .includes('application/x-www-form-urlencoded') ?? false;

    if (authFailureLimiter.isLimited(address)) {
        // Nothing about the attempt is examined once the budget is gone, so a
        // limited client learns nothing by continuing to guess.
        console.warn(`[auth] ticket login rate limited: client=${address}`);
        if (isInvitationForm) return invitationFailure('limited');
        return NextResponse.json({ error: RATE_LIMITED }, {
            status: 429,
            headers: { 'Retry-After': String(authFailureLimiter.retryAfterSeconds(address)) },
        });
    }

    let code: string;
    let email: string;
    let displayName: string;
    let acceptedInvitationTerms = false;
    try {
        const fields = isInvitationForm
            ? Object.fromEntries(await request.formData())
            : ((await request.json()) as Record<string, unknown> | null) ?? {};
        code = typeof fields.code === 'string' ? normalizeTicketCode(fields.code) : '';
        email = typeof fields.email === 'string' ? normalizeLoginEmail(fields.email) : '';
        displayName = typeof fields.name === 'string' ? normalizeDisplayName(fields.name) : '';
        acceptedInvitationTerms = fields.termsAccepted === 'accepted';
    } catch {
        code = '';
        email = '';
        displayName = '';
    }

    const promoCandidate = isPlausiblePromoCode(code);
    if (
        (!promoCandidate && code.length < 16) ||
        !isPlausibleEmail(email) ||
        !isValidDisplayName(displayName) ||
        (isInvitationForm && (!promoCandidate || !acceptedInvitationTerms))
    ) {
        return reject(address, 'malformed_request', isInvitationForm);
    }

    let attempt: Attempt;
    try {
        if (promoCandidate) {
            if (!promoInvitationsEnabled()) {
                return reject(address, 'promo_unavailable', isInvitationForm);
            }
            const now = new Date();
            const promoAttempt = isInvitationForm
                ? await redeemPromoInvitation(
                    code,
                    email,
                    displayName,
                    now,
                    { version: INVITATION_TERMS_VERSION, acceptedAt: now },
                )
                : await redeemPromoInvitation(code, email, displayName);
            attempt = promoAttempt.ok
                ? promoAttempt
                : { ok: false, reason: 'promo_unavailable' };
        } else {
            const codeDigest = digestTicketCode(code);
            attempt = await redeem(codeDigest, email, displayName);
        }
    } catch (error) {
        // Missing/invalid secret configuration is an outage, never evidence
        // that a particular ticket or invitation exists.
        console.error(`[auth] ticket login failed: client=${address} ${redactError(error)}`);
        if (isInvitationForm) return invitationFailure('unavailable');
        return NextResponse.json({ error: 'Login is temporarily unavailable.' }, { status: 500 });
    }

    if (!attempt.ok) {
        return reject(address, attempt.reason, isInvitationForm);
    }

    // Ticket id and last four are the admission-support handles the roadmap
    // allows in logs. The code and the email never appear.
    console.info(
        `[auth] ticket session issued: entitlement=${attempt.entitlementId} last4=${attempt.codeLastFour} client=${address}`,
    );

    const response = isInvitationForm
        ? NextResponse.redirect(
            new URL(`/session/${attempt.scheduledSessionId}`, PUBLIC_APP_ORIGIN),
            { status: 303 },
        )
        : NextResponse.json({ ok: true, scheduledSessionId: attempt.scheduledSessionId });
    response.cookies.set(sessionCookie(attempt.cookieValue));
    return response;
}

function reject(address: string, reason: FailureReason, invitationForm = false): NextResponse {
    authFailureLimiter.recordFailure(address);
    // `reason` is a fixed enum: useful to an operator reading container logs,
    // and free of the code, the email, and any hint of which exists.
    console.warn(`[auth] ticket login rejected: reason=${reason} client=${address}`);
    if (invitationForm) return invitationFailure(reason === 'malformed_request' ? 'invalid' : 'unavailable');
    return NextResponse.json(
        { error: reason === 'malformed_request' ? MALFORMED_REQUEST : GENERIC_REJECTION },
        { status: reason === 'malformed_request' ? 400 : 401 },
    );
}

function invitationFailure(reason: 'invalid' | 'limited' | 'unavailable'): NextResponse {
    const returnUrl = new URL(INVITATION_RETURN_URL);
    returnUrl.searchParams.set('entry_error', reason);
    return NextResponse.redirect(returnUrl, { status: 303 });
}

/**
 * Bind on first use and issue a session, in one transaction.
 *
 * The race that matters: two first-use requests with different emails arriving
 * together. Both read `boundEmail = null`, then both attempt the conditional
 * update. Postgres serializes the two row updates; the second re-evaluates its
 * `boundEmail: null` predicate against the winner's committed row, matches
 * nothing, and reports `count = 0`. Re-reading then shows an email that is not
 * its own, so the loser is rejected exactly like a nonexistent code — one
 * winner, no partial state, and no session issued to the loser.
 *
 * The same path also handles the ordinary repeat login: `count = 0` with a
 * matching email is a re-entry, not a conflict.
 */
async function redeem(
    codeDigest: string,
    email: string,
    displayName: string,
    now = new Date(),
): Promise<Attempt> {
    return prisma.$transaction(async (tx) => {
        // Shared commerce mutex: provisioning/revocation updates this same row.
        // Holding it through WebSession creation prevents a login from using a
        // pre-revocation read and committing a fresh session afterwards.
        await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "ticket_entitlements" WHERE "code_digest" = ${codeDigest} FOR UPDATE`,
        );
        const entitlement = await tx.ticketEntitlement.findUnique({
            where: { codeDigest },
            select: {
                id: true,
                scheduledSessionId: true,
                codeLastFour: true,
                state: true,
                boundEmail: true,
                expiresAt: true,
                revokedAt: true,
            },
        });

        if (!entitlement) {
            return { ok: false, reason: 'unknown_code' };
        }
        if (entitlement.revokedAt !== null || entitlement.state === 'REVOKED') {
            return { ok: false, reason: 'revoked' };
        }
        if (entitlement.state === 'EXPIRED' || entitlement.expiresAt.getTime() <= now.getTime()) {
            return { ok: false, reason: 'expired' };
        }

        if (entitlement.boundEmail === null) {
            const bound = await tx.ticketEntitlement.updateMany({
                where: { id: entitlement.id, boundEmail: null, state: 'ISSUED', revokedAt: null },
                data: { boundEmail: email, boundAt: now, state: 'BOUND' },
            });

            if (bound.count !== 1) {
                const current = await tx.ticketEntitlement.findUnique({
                    where: { id: entitlement.id },
                    select: { boundEmail: true },
                });
                if (current?.boundEmail == null) {
                    // Neither bound by us nor by anyone else: the row is in a state
                    // this flow cannot bind (already BOUND with no email, say).
                    return { ok: false, reason: 'binding_lost' };
                }
                if (current.boundEmail !== email) {
                    return { ok: false, reason: 'email_mismatch' };
                }
            }
        } else if (entitlement.boundEmail !== email) {
            return { ok: false, reason: 'email_mismatch' };
        }

        const issued = newSessionToken();
        await tx.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                displayName,
                ticketEntitlementId: entitlement.id,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });

        return {
            ok: true,
            scheduledSessionId: entitlement.scheduledSessionId,
            entitlementId: entitlement.id,
            codeLastFour: entitlement.codeLastFour,
            cookieValue: issued.cookieValue,
        };
    });
}
