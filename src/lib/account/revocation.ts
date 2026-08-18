import type { Prisma } from '@prisma/client';

/** Delete bearer/refresh material before sessions so SET NULL cannot orphan it. */
export async function revokeAllAccountSessions(
    transaction: Prisma.TransactionClient,
    accountId: string,
): Promise<void> {
    const sessions = await transaction.earlyBirdAuthSession.findMany({
        where: { userId: accountId }, select: { id: true },
    });
    const sessionIds = sessions.map(({ id }) => id);
    await transaction.beaconOAuthAccessToken.deleteMany({ where: {
        OR: [{ userId: accountId }, { sessionId: { in: sessionIds } }],
    } });
    await transaction.beaconOAuthRefreshToken.deleteMany({ where: {
        OR: [{ userId: accountId }, { sessionId: { in: sessionIds } }],
    } });
    await transaction.earlyBirdAuthSession.deleteMany({ where: { userId: accountId } });
}

export async function revokeAccountSession(
    transaction: Prisma.TransactionClient,
    sessionId: string,
): Promise<void> {
    await transaction.beaconOAuthAccessToken.deleteMany({ where: { sessionId } });
    await transaction.beaconOAuthRefreshToken.deleteMany({ where: { sessionId } });
    await transaction.earlyBirdAuthSession.deleteMany({ where: { id: sessionId } });
}
