/**
 * The weekend's authorization boundary.
 *
 * Every protected request resolves its principal here, against the database, on
 * every call. Section 1 of the weekend roadmap requires it: "Every request
 * resolves the session against the database and the current ticket status.
 * Revoking a ticket therefore invalidates an existing cookie as well as new
 * logins." A cached claim in a signed token could not do that — the operator
 * revoking a ticket mid-event would be told it worked while the holder kept
 * their access until the token expired.
 *
 * `middleware.ts` also looks at the cookie, but only to redirect a visitor who
 * obviously has no session. It cannot reach the database from the edge runtime
 * and is not permitted to be the gate. Nothing may rely on it having run.
 *
 * A resolved principal is deliberately free of personal data: no email, no
 * ticket code. Downstream consumers (LiveKit identities, tapestry keys, logs)
 * can therefore carry it around without leaking an attendee's identity, and
 * "neither token embeds email or ticket code" holds by construction rather than
 * by review.
 */

import { cookies } from 'next/headers';
import type { StaffRole, TicketTier } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
    beaconAccountEnabled,
    storedAccountIdentity,
    validatedAccountIdentity,
    type AccountIdentity,
} from '@/lib/account-rp';
import {
    SESSION_COOKIE_NAME,
    digestSessionToken,
    issueSessionToken,
    sessionCookieOptions,
    sessionCookieTtlSeconds,
    sessionTokenMatchesDigest,
} from '@/lib/session-auth';

export type AttendeePrincipal = {
    kind: 'attendee';
    webSessionId: string;
    entitlementId: string;
    scheduledSessionId: string;
    tier: TicketTier;
    /** Support handle for admission: enough to find a ticket, not to identify a person. */
    codeLastFour: string;
    /** Present only under the central Account RP feature. Never an email. */
    accountId?: string;
};

export type StaffPrincipal = {
    kind: 'staff';
    webSessionId: string;
    userId: string;
    role: StaffRole;
    accountId?: string;
};

export type Principal = AttendeePrincipal | StaffPrincipal;

/**
 * The identity contract's normalization: `trim(email).toLowerCase()`. First use
 * binds this form and later use compares against it, so a ticket bought as
 * " Ana@Example.com " still admits `ana@example.com` after a browser restart.
 */
export function normalizeLoginEmail(rawEmail: string): string {
    return rawEmail.trim().toLowerCase();
}

/** A short participant-chosen label safe for room tiles and operator controls. */
export function normalizeDisplayName(rawName: string): string {
    return rawName.trim().replace(/\s+/g, ' ').slice(0, 60);
}

export function isValidDisplayName(name: string): boolean {
    return name.length > 0 && name.length <= 60 && !/[\u0000-\u001f\u007f]/.test(name);
}

/**
 * Shape check only. There is no email delivery anywhere in this product, so an
 * address is a matching key rather than a channel and its deliverability is not
 * ours to judge — rejecting an unusual but real address would lock a paying
 * attendee out of the event they bought.
 */
export function isPlausibleEmail(email: string): boolean {
    if (email.length === 0 || email.length > 254 || /\s/.test(email)) {
        return false;
    }
    const parts = email.split('@');
    if (parts.length !== 2) {
        return false;
    }
    const [local, domain] = parts;
    return local.length > 0 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

export function webSessionExpiry(now = new Date()): Date {
    return new Date(now.getTime() + sessionCookieTtlSeconds() * 1000);
}

/** The `hb_session` cookie to write on a successful login. */
export function sessionCookie(cookieValue: string, now = new Date()) {
    return {
        name: SESSION_COOKIE_NAME,
        value: cookieValue,
        ...sessionCookieOptions(now),
    };
}

/**
 * The cookie that replaces it on logout. Same attributes, empty value, expired:
 * a browser only overwrites a cookie when name, path and domain all match.
 */
export function clearedSessionCookie() {
    return {
        name: SESSION_COOKIE_NAME,
        value: '',
        httpOnly: true as const,
        secure: true as const,
        sameSite: 'lax' as const,
        path: '/' as const,
        maxAge: 0,
        expires: new Date(0),
    };
}

export function newSessionToken() {
    return issueSessionToken();
}

/** Resolve the central Account session even before a ticket is attached. */
export async function accountIdentityFromToken(
    token: string | null | undefined,
    now = new Date(),
    requireFresh = true,
): Promise<AccountIdentity | null> {
    if (!beaconAccountEnabled() || !token) return null;
    const row = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(token) },
        select: {
            id: true,
            tokenDigest: true,
            expiresAt: true,
            revokedAt: true,
            accountIssuer: true,
            accountSubject: true,
            accountSessionId: true,
            accountDisplayName: true,
            accountValidatedAt: true,
        },
    });
    if (
        !row ||
        !sessionTokenMatchesDigest(token, row.tokenDigest) ||
        row.revokedAt ||
        row.expiresAt <= now
    ) return null;
    return requireFresh
        ? validatedAccountIdentity(row, now)
        : storedAccountIdentity(row);
}

export async function currentAccountIdentity(now = new Date()): Promise<AccountIdentity | null> {
    const store = await cookies();
    return accountIdentityFromToken(store.get(SESSION_COOKIE_NAME)?.value, now);
}

/**
 * Resolve an opaque cookie value into a principal, or null.
 *
 * Null covers every reason equally — no cookie, unknown token, expired or
 * revoked session, disabled staff account, revoked or expired ticket — because
 * every caller's response to all of them is the same 401.
 */
export async function principalFromToken(
    token: string | null | undefined,
    now = new Date(),
): Promise<Principal | null> {
    if (!token) {
        return null;
    }

    const webSession = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(token) },
        select: {
            id: true,
            tokenDigest: true,
            expiresAt: true,
            revokedAt: true,
            accountIssuer: true,
            accountSubject: true,
            accountSessionId: true,
            accountDisplayName: true,
            accountValidatedAt: true,
            staffUser: {
                select: {
                    id: true,
                    role: true,
                    disabledAt: true,
                    accountBinding: {
                        select: {
                            accountIssuer: true,
                            accountSubject: true,
                            disabledAt: true,
                        },
                    },
                },
            },
            ticketEntitlement: {
                select: {
                    id: true,
                    scheduledSessionId: true,
                    tier: true,
                    codeLastFour: true,
                    state: true,
                    expiresAt: true,
                    revokedAt: true,
                    accountId: true,
                    accountIssuer: true,
                },
            },
        },
    });

    if (!webSession) {
        return null;
    }

    // The lookup above already matched on equality; this is the constant-time
    // comparison the WS1-01 contract asks callers to use, kept so a future
    // change to a non-indexed lookup cannot quietly introduce a timing oracle.
    if (!sessionTokenMatchesDigest(token, webSession.tokenDigest)) {
        return null;
    }

    if (webSession.revokedAt !== null || webSession.expiresAt.getTime() <= now.getTime()) {
        return null;
    }

    const accountIdentity = beaconAccountEnabled()
        ? await validatedAccountIdentity(webSession, now)
        : null;
    if (beaconAccountEnabled() && !accountIdentity) {
        // Fifteen-minute Account freshness is enforced for every new protected
        // transition. Already-issued LiveKit tokens continue until their own
        // bounded expiry and are not recalled on an issuer outage.
        return null;
    }

    const staff = webSession.staffUser;
    if (staff) {
        if (staff.disabledAt !== null) {
            return null;
        }
        if (beaconAccountEnabled() && (
            !accountIdentity ||
            !staff.accountBinding ||
            staff.accountBinding.disabledAt !== null ||
            staff.accountBinding.accountIssuer !== accountIdentity.issuer ||
            staff.accountBinding.accountSubject !== accountIdentity.subject
        )) {
            return null;
        }
        return {
            kind: 'staff',
            webSessionId: webSession.id,
            userId: staff.id,
            role: staff.role,
            ...(accountIdentity ? { accountId: accountIdentity.subject } : {}),
        };
    }

    const entitlement = webSession.ticketEntitlement;
    if (entitlement) {
        // BOUND is the only admitting state. ISSUED means the code was never
        // redeemed, so a session pointing at one is incoherent; REVOKED and
        // EXPIRED are the operator's and the calendar's answers.
        if (entitlement.state !== 'BOUND') {
            return null;
        }
        if (entitlement.revokedAt !== null || entitlement.expiresAt.getTime() <= now.getTime()) {
            return null;
        }
        if (beaconAccountEnabled() && (
            entitlement.accountId !== accountIdentity?.subject ||
            entitlement.accountIssuer !== accountIdentity?.issuer
        )) {
            return null;
        }
        return {
            kind: 'attendee',
            webSessionId: webSession.id,
            entitlementId: entitlement.id,
            scheduledSessionId: entitlement.scheduledSessionId,
            tier: entitlement.tier,
            codeLastFour: entitlement.codeLastFour,
            ...(accountIdentity ? { accountId: accountIdentity.subject } : {}),
        };
    }

    // A session bound to neither a staff user nor a ticket cannot be authorized
    // for anything.
    return null;
}

/** Resolve the caller of the current request. */
export async function currentPrincipal(now = new Date()): Promise<Principal | null> {
    const store = await cookies();
    return principalFromToken(store.get(SESSION_COOKIE_NAME)?.value, now);
}

/**
 * Revoke the session a cookie names. Idempotent, and silent about whether the
 * token existed: logout is not an oracle for valid session tokens.
 */
export async function revokeWebSessionByToken(
    token: string | null | undefined,
    reason = 'logout',
    now = new Date(),
): Promise<void> {
    if (!token) {
        return;
    }

    await prisma.webSession.updateMany({
        where: { tokenDigest: digestSessionToken(token), revokedAt: null },
        data: { revokedAt: now, revocationReason: reason },
    });
}
