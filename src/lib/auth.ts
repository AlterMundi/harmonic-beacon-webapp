import { NextResponse } from 'next/server';
import type { StaffRole } from '@prisma/client';

import { auth } from '@/auth';
import {
    type AttendeePrincipal,
    type Principal,
    type StaffPrincipal,
    currentPrincipal,
} from '@/lib/principal';

export { auth } from '@/auth';

export type { AttendeePrincipal, Principal, StaffPrincipal } from '@/lib/principal';
export {
    clearedSessionCookie,
    currentPrincipal,
    isPlausibleEmail,
    normalizeLoginEmail,
    principalFromToken,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';

/**
 * Roles of the pre-weekend product, kept only for the surfaces the strip
 * removes. The weekend product's roles are Prisma's `StaffRole`.
 *
 * @deprecated Use `StaffRole` from `@prisma/client`.
 */
export type Role = 'ADMIN' | 'PROVIDER' | 'USER';

type LegacySession = {
    user: { id: string; email: string; name?: string | null; image?: string | null; role: Role };
};

const AUTHENTICATION_REQUIRED = 'Authentication required';
const INSUFFICIENT_PERMISSIONS = 'Insufficient permissions';

function unauthorized(): NextResponse {
    return NextResponse.json({ error: AUTHENTICATION_REQUIRED }, { status: 401 });
}

function forbidden(): NextResponse {
    return NextResponse.json({ error: INSUFFICIENT_PERMISSIONS }, { status: 403 });
}

/**
 * Require any authenticated weekend principal.
 *
 * `const [principal, errorResponse] = await requirePrincipal();` — the tuple
 * convention the existing API routes already use, so a caller cannot forget to
 * handle the failure and end up acting on an undefined identity.
 *
 * Authoritative: it resolves the `hb_session` cookie against `WebSession` and
 * the current entitlement/staff status on every call. See `@/lib/principal`.
 */
export async function requirePrincipal(): Promise<[Principal, null] | [null, NextResponse]> {
    const principal = await currentPrincipal();
    if (!principal) {
        return [null, unauthorized()];
    }
    return [principal, null];
}

/** Require a ticket holder. Staff are not attendees; they hold no entitlement. */
export async function requireAttendee(): Promise<[AttendeePrincipal, null] | [null, NextResponse]> {
    const [principal, errorResponse] = await requirePrincipal();
    if (!principal) {
        return [null, errorResponse];
    }
    if (principal.kind !== 'attendee') {
        return [null, forbidden()];
    }
    return [principal, null];
}

/**
 * Require a staff member, optionally in one of `roles`.
 *
 * Called with no roles it accepts any staff member; the caller is then asserting
 * that every staff role may perform the action. Prefer naming the roles.
 */
export async function requireStaff(
    ...roles: StaffRole[]
): Promise<[StaffPrincipal, null] | [null, NextResponse]> {
    const [principal, errorResponse] = await requirePrincipal();
    if (!principal) {
        return [null, errorResponse];
    }
    if (principal.kind !== 'staff') {
        return [null, forbidden()];
    }
    if (roles.length > 0 && !roles.includes(principal.role)) {
        return [null, forbidden()];
    }
    return [principal, null];
}

/**
 * Require a principal authorized for one scheduled session: the attendee whose
 * ticket names it, or staff who may operate any stage.
 *
 * Event-scoped resources (tokens, hands, tapestry frames) must use this rather
 * than `requireAttendee`, or a Saturday ticket would open Sunday's room.
 */
export async function requireSessionAccess(
    scheduledSessionId: string,
): Promise<[Principal, null] | [null, NextResponse]> {
    const [principal, errorResponse] = await requirePrincipal();
    if (!principal) {
        return [null, errorResponse];
    }
    if (principal.kind === 'attendee' && principal.scheduledSessionId !== scheduledSessionId) {
        return [null, forbidden()];
    }
    return [principal, null];
}

export function isAdmin(role: string): boolean {
    return role === 'ADMIN';
}

export function isAdminOrProvider(role: string): boolean {
    return role === 'ADMIN' || role === 'PROVIDER';
}

/**
 * Get authenticated session or return 401 response.
 * Use in API routes: const [session, errorResponse] = await requireAuth();
 *
 * @deprecated Pre-weekend surfaces only; use `requirePrincipal`,
 * `requireAttendee`, or `requireStaff`. Removed with the routes that call it.
 */
export async function requireAuth(): Promise<[LegacySession, null] | [null, NextResponse]> {
    const session = await auth();
    if (!session?.user?.id) {
        return [null, unauthorized()];
    }
    return [session as LegacySession, null];
}

/**
 * Get authenticated session with required role, or return 401/403 response.
 *
 * @deprecated See `requireAuth`.
 */
export async function requireRole(
    ...roles: string[]
): Promise<[LegacySession, null] | [null, NextResponse]> {
    const [session, errorResponse] = await requireAuth();
    if (!session) return [null, errorResponse];

    if (!roles.includes(session.user.role)) {
        return [null, forbidden()];
    }
    return [session, null];
}
