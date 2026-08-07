import type { EarlyBirdFreeSchedule, EarlyBirdMembershipProjection } from '@prisma/client';

import { prisma } from '@/lib/db';

import { freeWindowState, type EarlyBirdFreeWindowState } from './free-window';
import { membershipAccessDecision, type EarlyBirdAccessDecision } from './membership';

export type EarlyBirdListeningAccess = {
    allowed: boolean;
    kind: 'membership' | 'free-window' | 'denied';
    allowedUntil: Date | null;
    membership: EarlyBirdAccessDecision;
    freeWindow: EarlyBirdFreeWindowState;
};

function membershipBoundary(projection: EarlyBirdMembershipProjection): Date | null {
    if (projection.state === 'GRACE') return projection.graceUntil;
    if (projection.state === 'CANCELLED_PENDING_END') return projection.paidThrough;
    return projection.paidThrough;
}

export function listeningAccessDecision(
    projection: EarlyBirdMembershipProjection | null,
    schedule: EarlyBirdFreeSchedule | null,
    now = new Date(),
): EarlyBirdListeningAccess {
    const membership = membershipAccessDecision(projection, now);
    const freeWindow = freeWindowState(schedule, now);
    if (membership.allowed && membership.projection) {
        return {
            allowed: true,
            kind: 'membership',
            allowedUntil: membershipBoundary(membership.projection),
            membership,
            freeWindow,
        };
    }
    if (freeWindow.active && freeWindow.activeEnd) {
        return {
            allowed: true,
            kind: 'free-window',
            allowedUntil: freeWindow.activeEnd,
            membership,
            freeWindow,
        };
    }
    return {
        allowed: false,
        kind: 'denied',
        allowedUntil: null,
        membership,
        freeWindow,
    };
}

export async function getEarlyBirdListeningAccess(
    accountId: string,
    now = new Date(),
): Promise<EarlyBirdListeningAccess> {
    const [projection, schedule] = await Promise.all([
        prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
        prisma.earlyBirdFreeSchedule.findUnique({ where: { accountId } }),
    ]);
    return listeningAccessDecision(projection, schedule, now);
}
