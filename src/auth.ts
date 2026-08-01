/**
 * Legacy session adapter.
 *
 * Zitadel, OIDC and NextAuth are gone: the weekend product's identities are a
 * ticket code plus an email, and four seeded staff credentials. The authoritative
 * resolver is `@/lib/principal`, and new code must use `requirePrincipal`,
 * `requireAttendee`, or `requireStaff` from `@/lib/auth`.
 *
 * This shim exists because roughly thirty pre-weekend API routes still call
 * `requireAuth`/`requireRole`, and those routes are removed by the product strip
 * rather than by this card. Until they go, they keep exactly the gate they
 * already had, now backed by the `hb_session` cookie instead of a JWT.
 *
 * Role mapping is deliberately narrowing. Only a weekend `ADMIN` maps to the
 * legacy `ADMIN`; facilitators, operators and attendees all map to the least
 * privileged legacy role, and nothing maps to `PROVIDER`, so no weekend
 * principal inherits a permission its role was never granted.
 *
 * @deprecated Delete with the last caller of `requireAuth`/`requireRole`.
 */

import { currentPrincipal } from '@/lib/principal';
import { hasStaffCapability } from '@/lib/staff-capabilities';

export type LegacySession = {
    user: {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
        role: 'ADMIN' | 'PROVIDER' | 'USER';
    };
};

export async function auth(): Promise<LegacySession | null> {
    const principal = await currentPrincipal();
    if (!principal) {
        return null;
    }

    return {
        user: {
            // A stable non-PII principal id: the staff user row, or the ticket
            // the attendee redeemed.
            id: principal.kind === 'staff' ? principal.userId : principal.entitlementId,
            // No weekend principal carries an email here. The field is part of the
            // legacy shape; leaving it empty is the point, not an oversight.
            email: '',
            name: null,
            image: null,
            role: principal.kind === 'staff' && hasStaffCapability(principal.role, 'administer_system')
                ? 'ADMIN'
                : 'USER',
        },
    };
}
