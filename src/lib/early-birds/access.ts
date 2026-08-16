import type { EarlyBirdMembershipProjection } from '@prisma/client';

import { membershipAccessDecision, type EarlyBirdAccessDecision } from './membership';
import {
    serializeEarlyBirdQuotaSnapshot,
    settleLockedEarlyBirdQuota,
    type EarlyBirdQuotaSnapshot,
    type SerializedEarlyBirdQuotaSnapshot,
    withLockedQuotaTransaction,
} from './quota';

export type EarlyBirdListeningAccess = {
    allowed: boolean;
    kind: 'membership' | 'free-quota' | 'denied';
    allowedUntil: Date | null;
    membership: EarlyBirdAccessDecision;
    quota: EarlyBirdQuotaSnapshot | null;
    serverNow: Date;
};

export type SerializedEarlyBirdListeningAccess = {
    allowed: boolean;
    kind: EarlyBirdListeningAccess['kind'];
    allowedUntil: string | null;
    quota: SerializedEarlyBirdQuotaSnapshot | null;
};

function membershipBoundary(projection: EarlyBirdMembershipProjection): Date | null {
    if (projection.state === 'GRACE') return projection.graceUntil;
    return projection.paidThrough;
}

export function listeningAccessDecision(
    projection: EarlyBirdMembershipProjection | null,
    quota: EarlyBirdQuotaSnapshot,
    now = new Date(),
): EarlyBirdListeningAccess {
    const membership = membershipAccessDecision(projection, now);
    if (membership.allowed && membership.projection) {
        return {
            allowed: true,
            kind: 'membership',
            allowedUntil: membershipBoundary(membership.projection),
            membership,
            quota: null,
            serverNow: now,
        };
    }
    if (quota.remainingMs > 0) {
        return {
            allowed: true,
            kind: 'free-quota',
            // Predicted exhaustion is truthful only while the union meter is
            // active. An idle account has quota, not a wall-clock window.
            allowedUntil: quota.activelyConsuming ? quota.exhaustsAt : null,
            membership,
            quota,
            serverNow: now,
        };
    }
    return {
        allowed: false,
        kind: 'denied',
        allowedUntil: null,
        membership,
        quota,
        serverNow: now,
    };
}

export function serializeEarlyBirdListeningAccess(
    access: EarlyBirdListeningAccess,
): SerializedEarlyBirdListeningAccess {
    return {
        allowed: access.allowed,
        kind: access.kind,
        allowedUntil: access.allowedUntil?.toISOString() ?? null,
        quota: access.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null,
    };
}

/**
 * Access reconciliation is serialized with lease presence changes. Production
 * callers always use PostgreSQL time through withQuotaTransaction; fake time
 * remains confined to the pure decision/ledger functions.
 */
export async function getEarlyBirdListeningAccess(
    accountId: string,
): Promise<EarlyBirdListeningAccess> {
    return withLockedQuotaTransaction(accountId, async (tx, now) => {
        const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
        const quota = await settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
        return listeningAccessDecision(projection, quota, now);
    });
}
