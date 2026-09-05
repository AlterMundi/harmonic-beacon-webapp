import { Prisma } from '@prisma/client';

/**
 * Canonical lock order for every operation that can change room authority:
 * session -> entitlement/campaign/staff principal -> participant.
 * Callers may discover immutable foreign keys before locking, but must reread
 * authorization only after this scope has been acquired.
 */
export async function lockGrantSession(
    tx: Prisma.TransactionClient,
    scheduledSessionId: string,
): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "scheduled_sessions"
        WHERE "id"::text = ${scheduledSessionId}
        FOR UPDATE
    `);
}

export async function lockGrantTickets(
    tx: Prisma.TransactionClient,
    ticketEntitlementIds: string[],
): Promise<void> {
    const ids = [...new Set(ticketEntitlementIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ticket_entitlements"
        WHERE "id"::text IN (${Prisma.join(ids)})
        ORDER BY "id"
        FOR UPDATE
    `);
}

export async function lockGrantCampaigns(
    tx: Prisma.TransactionClient,
    campaignIds: string[],
): Promise<void> {
    const ids = [...new Set(campaignIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "promo_invitations"
        WHERE "id"::text IN (${Prisma.join(ids)})
        ORDER BY "id"
        FOR UPDATE
    `);
}

export async function lockGrantStaff(
    tx: Prisma.TransactionClient,
    staffUserIds: string[],
): Promise<void> {
    const ids = [...new Set(staffUserIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "users"
        WHERE "id"::text IN (${Prisma.join(ids)})
        ORDER BY "id"
        FOR UPDATE
    `);
}

export async function lockGrantParticipants(
    tx: Prisma.TransactionClient,
    participantIds: string[],
): Promise<void> {
    const ids = [...new Set(participantIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "session_participants"
        WHERE "id"::text IN (${Prisma.join(ids)})
        ORDER BY "id"
        FOR UPDATE
    `);
}
