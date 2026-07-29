/**
 * Staff session resolution for the operator (/ops) surface.
 *
 * Staff authenticate at /staff/login (WS1-02) and receive the same opaque
 * `hb_session` cookie mechanism as attendees; what distinguishes a staff
 * session is `WebSession.staffUserId`. Every /ops route resolves the cookie
 * against the database on each request — middleware is never the
 * authorization boundary — so disabling a staff user or revoking their
 * session takes effect on the next call.
 *
 * This helper is deliberately separate from the attendee login stack owned by
 * WS1-02; it only reads `WebSession`/`User` and never issues cookies.
 */

import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { SESSION_COOKIE_NAME, digestSessionToken } from '@/lib/session-auth';

export type StaffRole = 'FACILITATOR' | 'OPERATOR' | 'ADMIN';

export type StaffPrincipal = {
    id: string;
    email: string;
    name: string;
    role: StaffRole;
};

/**
 * Resolve an `hb_session` cookie value to the staff member it belongs to, or
 * null when the session is missing, expired, revoked, belongs to an attendee
 * rather than staff, or the staff account has been disabled.
 */
export async function resolveStaffByToken(token: string | undefined): Promise<StaffPrincipal | null> {
    if (!token) {
        return null;
    }

    const session = await prisma.webSession.findUnique({
        where: { tokenDigest: digestSessionToken(token) },
        include: { staffUser: true },
    });

    if (!session || !session.staffUser) {
        return null;
    }
    if (session.revokedAt !== null || session.expiresAt <= new Date()) {
        return null;
    }
    if (session.staffUser.disabledAt !== null) {
        return null;
    }

    return {
        id: session.staffUser.id,
        email: session.staffUser.email,
        name: session.staffUser.name,
        role: session.staffUser.role,
    };
}

export async function resolveStaffSession(request: NextRequest): Promise<StaffPrincipal | null> {
    return resolveStaffByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export function hasAnyRole(principal: StaffPrincipal, roles: StaffRole[]): boolean {
    return roles.includes(principal.role);
}
