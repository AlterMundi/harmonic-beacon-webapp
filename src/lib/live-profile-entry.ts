import { prisma } from '@/lib/db';
import { LIVE_PRESENCE_GRACE_MS } from '@/lib/live-presence';

/** Profile completion gates new entry, not a participation with a current lease. */
export async function liveProfileEntryAllowed(input: {
    complete: boolean | null | undefined;
    scheduledSessionId: string;
    ticketEntitlementId?: string | null;
    now?: Date;
}): Promise<boolean> {
    if (input.complete === true) return true;
    if (!input.ticketEntitlementId) return false;
    const now = input.now ?? new Date();
    const active = await prisma.livePresenceInterval.findFirst({
        where: {
            scheduledSessionId: input.scheduledSessionId,
            endedAt: null,
            lastHeartbeatAt: { gte: new Date(now.getTime() - LIVE_PRESENCE_GRACE_MS), lte: now },
            participant: { ticketEntitlementId: input.ticketEntitlementId, leftAt: null },
        },
        select: { id: true },
    });
    return Boolean(active);
}
