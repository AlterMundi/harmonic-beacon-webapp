import { createHash } from 'node:crypto';

import type { AccountIdentity } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import { digestSessionToken } from '@/lib/session-auth';

type PublicSession = {
    id: string;
    scheduledAt: Date;
    publicAccess: boolean;
};

function publicEntitlementDigest(sessionId: string, account: AccountIdentity): string {
    return createHash('sha256')
        .update(`public-session\0${sessionId}\0${account.issuer}\0${account.subject}`)
        .digest('hex');
}

/**
 * Attach a free public event to an already authenticated Beacon Account.
 * This is the free-event bridge into the existing ticket-shaped room
 * authorization boundary; it never changes the Account login implementation.
 */
export async function attachPublicSessionAccess(
    cookieValue: string,
    session: PublicSession,
    account: AccountIdentity,
    now = new Date(),
): Promise<boolean> {
    if (!session.publicAccess) return false;

    const expiresAt = new Date(Math.max(
        session.scheduledAt.getTime() + 24 * 60 * 60 * 1000,
        now.getTime() + 60 * 60 * 1000,
    ));
    const codeDigest = publicEntitlementDigest(session.id, account);

    return prisma.$transaction(async (tx) => {
        const entitlement = await tx.ticketEntitlement.upsert({
            where: { codeDigest },
            update: {},
            create: {
                scheduledSessionId: session.id,
                codeDigest,
                codeLastFour: 'FREE',
                tier: 'COMP',
                state: 'BOUND',
                accountId: account.subject,
                accountIssuer: account.issuer,
                accountEmail: account.email ?? null,
                accountEmailVerified: account.email ? account.emailVerified ?? null : null,
                boundAt: now,
                expiresAt,
            },
            select: { id: true },
        });

        const existing = await tx.webSession.findUnique({
            where: { tokenDigest: digestSessionToken(cookieValue) },
            select: { ticketEntitlementId: true, displayName: true, displayNameConfirmedAt: true },
        });
        const participant = await tx.sessionParticipant.findFirst({
            where: { scheduledSessionId: session.id, ticketEntitlementId: entitlement.id },
            select: { displayName: true },
        });
        const sameEvent = existing?.ticketEntitlementId === entitlement.id;
        const retainedName = sameEvent && existing?.displayNameConfirmedAt
            ? existing.displayName : participant?.displayName;
        const displayName = retainedName?.trim() || account.displayName?.trim() || 'Participante';
        const confirmedAt = retainedName?.trim()
            ? (sameEvent ? existing?.displayNameConfirmedAt : null) ?? now
            : account.profileComplete === true && account.displayName?.trim() ? now : null;

        const attached = await tx.webSession.updateMany({
            where: {
                tokenDigest: digestSessionToken(cookieValue),
                accountIssuer: account.issuer,
                accountSubject: account.subject,
                staffUserId: null,
                revokedAt: null,
                expiresAt: { gt: now },
            },
            data: {
                ticketEntitlementId: entitlement.id,
                displayName,
                displayNameConfirmedAt: confirmedAt,
                lastSeenAt: now,
            },
        });
        return attached.count === 1;
    });
}
