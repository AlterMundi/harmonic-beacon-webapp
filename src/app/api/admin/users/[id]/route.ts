import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/users/[id]
 *
 * Refuses. Roles are granted in Zitadel, not here.
 *
 * `User.role` is a projection of the Zitadel project-role claim, rewritten from
 * that claim on every fresh sign-in (`src/lib/auth-config.ts`). Writing it here
 * used to appear to work and then revert: an Admin got a success response, the
 * table showed the new role, and the grant vanished the next time that person
 * signed in, with nothing recording that it had. A control that silently undoes
 * itself is worse than one that refuses, because the refusal is at least visible
 * at the moment of the decision.
 *
 * The attempt is still audited. An Admin reaching for this is a fact worth
 * having — it says the UI is still steering someone toward a control that should
 * no longer be reachable.
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        let requestedRole: unknown;
        try {
            ({ role: requestedRole } = await request.json());
        } catch {
            // A malformed or body-less request gets the same refusal. What matters
            // is where roles are granted, not whether this particular one parsed.
        }

        const target = await prisma.user.findUnique({
            where: { id },
            select: { role: true },
        });

        if (!target) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        await logAdminAction(session, {
            action: 'user.role_change_refused',
            targetType: 'USER',
            targetId: id,
            metadata: {
                currentRole: target.role,
                requestedRole: typeof requestedRole === 'string' ? requestedRole : null,
                reason: 'roles are granted in Zitadel',
            },
        });

        return NextResponse.json(
            {
                error: 'Roles are not granted here',
                detail:
                    'This platform reads roles from the Zitadel project-role claim and refreshes ' +
                    'them at sign-in, so a role written here would be overwritten the next time ' +
                    'this person signs in. Grant or revoke the role in Zitadel — it takes effect ' +
                    'on their next sign-in.',
                grantIn: process.env.AUTH_ZITADEL_ISSUER ?? null,
                claims: { ADMIN: 'BEAC_ADMIN', PROVIDER: 'BEAC_PROVIDER' },
                currentRole: target.role,
            },
            { status: 409 },
        );
    } catch (error) {
        console.error('Role change refusal failed:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to read user' }, { status: 500 });
    }
}
