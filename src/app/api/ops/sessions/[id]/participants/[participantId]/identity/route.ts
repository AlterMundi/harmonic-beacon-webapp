import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchAccountAdminProfile } from '@/lib/account-admin-profile';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
});

export async function GET(_request: Request, { params }: {
    params: Promise<{ id: string; participantId: string }>;
}) {
    const [admin, denied] = await requireStaff('ADMIN');
    if (!admin) return denied;
    const { id, participantId } = await params;
    const participant = await prisma.sessionParticipant.findFirst({
        where: { id: participantId, scheduledSessionId: id },
        select: {
            id: true, displayName: true,
            ticketEntitlement: { select: { accountIssuer: true, accountId: true } },
            staffUser: { select: { accountBinding: { select: { accountIssuer: true, accountSubject: true } } } },
        },
    });
    if (!participant) return reply({ error: 'Not found' }, 404);
    const issuer = participant.ticketEntitlement?.accountIssuer ?? participant.staffUser?.accountBinding?.accountIssuer;
    const subject = participant.ticketEntitlement?.accountId ?? participant.staffUser?.accountBinding?.accountSubject;
    // Record access without copying personal data into the audit trail.
    await prisma.auditLog.create({ data: {
        actorUserId: admin.userId, actorRole: 'ADMIN', action: 'participant.identity.read',
        targetType: 'SESSION_PARTICIPANT', targetId: participant.id,
    } });
    if (!issuer || !subject) return reply({ participantId, alias: participant.displayName, identity: null, status: 'unknown' });
    try {
        const profile = await fetchAccountAdminProfile(issuer, subject);
        return reply({ participantId, alias: participant.displayName,
            identity: { issuer, subject, profile }, status: profile ? 'current' : 'unknown' });
    } catch {
        return reply({ error: 'Account profile unavailable' }, 503);
    }
}
