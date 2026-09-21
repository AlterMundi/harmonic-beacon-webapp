import type { Prisma } from '@prisma/client';

import type { AccountIdentity } from '@/lib/account-rp';

export const AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS = 254;

/**
 * Fill only a missing public-attendance snapshot from fresh, verified Account
 * UserInfo. The opaque issuer/subject binding is the sole join authority.
 */
export async function convergeVerifiedAccountAttendanceEmail(
    tx: Pick<Prisma.TransactionClient, 'ticketEntitlement'>,
    identity: Pick<AccountIdentity, 'issuer' | 'subject' | 'email' | 'emailVerified'>,
): Promise<number> {
    const email = identity.email;
    if (
        !email ||
        identity.emailVerified !== true ||
        Array.from(email).length > AMPLIFICATION_CREDIT_EMAIL_MAX_CHARS
    ) return 0;

    const result = await tx.ticketEntitlement.updateMany({
        where: {
            accountIssuer: identity.issuer,
            accountId: identity.subject,
            accountEmail: null,
            accountEmailVerified: null,
            boundEmail: null,
            tier: 'COMP',
            codeLastFour: 'FREE',
            scheduledSession: { is: { publicAccess: true } },
            commerceEntitlement: { is: null },
        },
        data: {
            accountEmail: email,
            accountEmailVerified: true,
        },
    });
    return result.count;
}
