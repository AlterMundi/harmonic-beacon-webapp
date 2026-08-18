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
 * This is the registration-free bridge into the existing ticket-shaped room
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
                boundAt: now,
                expiresAt,
            },
            select: { id: true },
        });

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
                displayName: account.displayName?.trim() || 'Participante',
                lastSeenAt: now,
            },
        });
        return attached.count === 1;
    });
}
