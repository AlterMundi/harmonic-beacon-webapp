import type {
    Prisma,
    ScheduledSessionStatus,
    SessionLanguage,
    StaffRole,
} from '@prisma/client';

import { prisma } from '@/lib/db';
import type { StaffPrincipal } from '@/lib/ops-auth';
import { hasGlobalEventAccess } from '@/lib/staff-capabilities';

export type StaffEvent = {
    id: string;
    title: string;
    language: SessionLanguage;
    status: ScheduledSessionStatus;
    scheduledAt: Date;
    startedAt: Date | null;
    isTest: boolean;
    facilitatorId: string;
    facilitator: { name: string };
};

const ACTIONABLE_STATUSES = ['LIVE', 'SCHEDULED'] as const;

export function staffEventWhere(
    staff: Pick<StaffPrincipal, 'id' | 'role'>,
): Prisma.ScheduledSessionWhereInput {
    return {
        status: { in: [...ACTIONABLE_STATUSES] },
        ...(!hasGlobalEventAccess(staff.role)
            ? { facilitatorId: staff.id }
            : {}),
    };
}

/** Keep urgent events first without relying on database enum sort order. */
export function orderStaffEvents(events: readonly StaffEvent[]): StaffEvent[] {
    return [...events].sort((a, b) => {
        const statusDelta = Number(b.status === 'LIVE') - Number(a.status === 'LIVE');
        return statusDelta || a.scheduledAt.getTime() - b.scheduledAt.getTime();
    });
}

export async function listStaffEvents(
    staff: Pick<StaffPrincipal, 'id' | 'role'>,
): Promise<StaffEvent[]> {
    const events = await prisma.scheduledSession.findMany({
        where: staffEventWhere(staff),
        orderBy: { scheduledAt: 'asc' },
        select: {
            id: true,
            title: true,
            language: true,
            status: true,
            scheduledAt: true,
            startedAt: true,
            isTest: true,
            facilitatorId: true,
            facilitator: { select: { name: true } },
        },
    });
    return orderStaffEvents(events);
}

/**
 * Post-login and recovery destination.
 *
 * Operators/admins start from the global hub. Facilitator-capable roles enter
 * their assigned live event first, otherwise their next assigned event. A
 * composite facilitator with no active assignment retains its global hub.
 */
export function staffLandingPath(
    staff: Pick<StaffPrincipal, 'id' | 'role'>,
    events: readonly Pick<StaffEvent, 'id' | 'facilitatorId' | 'status' | 'scheduledAt'>[],
): string {
    if (staff.role === 'OPERATOR' || staff.role === 'ADMIN') {
        return '/ops/events';
    }

    const assigned = [...events]
        .filter((event) => event.facilitatorId === staff.id)
        .sort((a, b) => {
            const statusDelta = Number(b.status === 'LIVE') - Number(a.status === 'LIVE');
            return statusDelta || a.scheduledAt.getTime() - b.scheduledAt.getTime();
        });
    return assigned[0] ? `/ops/events/${assigned[0].id}` : '/ops/events';
}

export async function resolveStaffLanding(
    staff: Pick<StaffPrincipal, 'id' | 'role'>,
): Promise<string> {
    const events = await listStaffEvents(staff);
    return staffLandingPath(staff, events);
}

export function isFacilitatorRole(role: StaffRole): boolean {
    return role === 'FACILITATOR' || role === 'FACILITATOR_OP';
}
