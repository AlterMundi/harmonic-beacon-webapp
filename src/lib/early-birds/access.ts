import type {
    EarlyBirdFreeSchedule,
    EarlyBirdMembershipProjection,
    EarlyBirdWelcomeAccess,
} from '@prisma/client';

import { prisma } from '@/lib/db';

import { freeWindowState, type EarlyBirdFreeWindowState } from './free-window';
import { membershipAccessDecision, type EarlyBirdAccessDecision } from './membership';
import { welcomeAccessState, type EarlyBirdWelcomeAccessState } from './welcome-access';

export const LEGACY_LISTENER_POLICY_VERSION = 'legacy-daily-v1' as const;

export class EarlyBirdListenerPolicyMismatchError extends Error {
    constructor() {
        super('This Listener image is not compatible with the active access policy');
        this.name = 'EarlyBirdListenerPolicyMismatchError';
    }
}

export function legacyListenerPolicyCompatible(policyVersion: string | null): boolean {
    return policyVersion === LEGACY_LISTENER_POLICY_VERSION;
}

async function assertLegacyListenerPolicyCompatible(): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ policyVersion: string }>>`
        SELECT "policy_version" AS "policyVersion"
        FROM "early_bird_listener_authority_policy"
        WHERE "id" = 1
    `;
    if (!legacyListenerPolicyCompatible(rows[0]?.policyVersion ?? null)) {
        throw new EarlyBirdListenerPolicyMismatchError();
    }
}

export type EarlyBirdListeningAccess = {
    allowed: boolean;
    kind: 'membership' | 'free-window' | 'welcome' | 'denied';
    allowedUntil: Date | null;
    membership: EarlyBirdAccessDecision;
    freeWindow: EarlyBirdFreeWindowState;
    welcome: EarlyBirdWelcomeAccessState;
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
    welcomeAccess: EarlyBirdWelcomeAccess | null = null,
): EarlyBirdListeningAccess {
    const membership = membershipAccessDecision(projection, now);
    const freeWindow = freeWindowState(schedule, now);
    const welcome = welcomeAccessState(
        welcomeAccess,
        now,
        !membership.allowed && schedule === null,
    );
    if (membership.allowed && membership.projection) {
        return {
            allowed: true,
            kind: 'membership',
            allowedUntil: membershipBoundary(membership.projection),
            membership,
            freeWindow,
            welcome,
        };
    }
    if (freeWindow.active && freeWindow.activeEnd) {
        return {
            allowed: true,
            kind: 'free-window',
            allowedUntil: freeWindow.activeEnd,
            membership,
            freeWindow,
            welcome,
        };
    }
    if (welcome.active && welcome.endsAt) {
        return {
            allowed: true,
            kind: 'welcome',
            allowedUntil: welcome.endsAt,
            membership,
            freeWindow,
            welcome,
        };
    }
    return {
        allowed: false,
        kind: 'denied',
        allowedUntil: null,
        membership,
        freeWindow,
        welcome,
    };
}

export async function getEarlyBirdListeningAccess(
    accountId: string,
    now = new Date(),
): Promise<EarlyBirdListeningAccess> {
    // Unit tests exercise the pure legacy decision without a database marker.
    // Every deployed Listener runs NODE_ENV=production and must prove its
    // exact policy compatibility before reading legacy schedule/welcome state.
    if (process.env.NODE_ENV === 'production') {
        await assertLegacyListenerPolicyCompatible();
    }
    const [projection, schedule, welcome] = await Promise.all([
        prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
        prisma.earlyBirdFreeSchedule.findUnique({ where: { accountId } }),
        prisma.earlyBirdWelcomeAccess.findUnique({ where: { accountId } }),
    ]);
    return listeningAccessDecision(projection, schedule, now, welcome);
}
