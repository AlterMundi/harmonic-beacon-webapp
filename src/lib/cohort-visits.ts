import { createHash } from 'node:crypto';
import type { AccountIdentity } from '@/lib/account-rp';
import { prisma } from '@/lib/db';

export const COHORT_VISITS_CUTOFF = '2026-09-23T21:00:00Z';
export const COHORT_VISIT_ACTION = 'pmp_cohort_authenticated_visit_v2';
export type CohortVisitSurface = 'landing' | 'session';

/** An observation, not enrolment or LiveKit attendance. No client timestamps. */
export async function recordCohortVisit(
    account: AccountIdentity,
    surface: CohortVisitSurface,
    now = new Date(),
): Promise<boolean> {
    if (now.getTime() < Date.parse(COHORT_VISITS_CUTOFF)) return false;
    const targetId = createHash('sha256').update(JSON.stringify([
        COHORT_VISIT_ACTION, account.issuer, account.subject,
    ])).digest('hex');
    const hex = createHash('sha256').update(JSON.stringify([
        targetId, surface, Math.floor(now.getTime() / 60_000),
    ])).digest('hex').slice(0, 32);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    await prisma.auditLog.createMany({
        data: [{
            id, action: COHORT_VISIT_ACTION, targetType: 'beacon_account_visit', targetId,
            metadata: { issuer: account.issuer, subject: account.subject, surface },
            createdAt: now,
        }],
        skipDuplicates: true,
    });
    return true;
}
