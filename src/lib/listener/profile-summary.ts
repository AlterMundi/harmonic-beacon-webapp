import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { listenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_INTERVAL_HEARTBEAT_GRACE_MS } from '@/lib/early-birds/listening-intervals';

export function profileIdentityKey(issuer: string, subject: string): string {
    return createHash('sha256').update(`hb-profile-v1\0${issuer}\0${subject}`).digest('hex');
}

export function listeningSeconds(windows: { startedAt: Date; lastHeartbeatAt: Date; endedAt: Date | null }[], now: Date): number {
    const spans = windows.map(window => [window.startedAt.getTime(), Math.min(now.getTime(),
        window.endedAt?.getTime() ?? Infinity, window.lastHeartbeatAt.getTime() + LISTENER_INTERVAL_HEARTBEAT_GRACE_MS)])
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .sort((a, b) => a[0] - b[0]);
    let total = 0; let from = 0; let through = 0;
    for (const [start, end] of spans) {
        if (start > through) { total += Math.max(0, through - from); from = start; through = end; }
        else through = Math.max(through, end);
    }
    return Math.floor((total + Math.max(0, through - from)) / 1000);
}

/** Read only. Never settle quota, grant a membership or look up another account. */
export async function listenerProfileSummary(accountId: string, issuer: string, now = new Date()) {
    const subject = await prisma.listenerAccountSubject.findUnique({ where: { accountId } });
    if (!subject || subject.issuer !== issuer) return null;
    const [membership, intervals] = await Promise.all([
        prisma.earlyBirdMembershipProjection.findUnique({ where: { accountId } }),
        prisma.earlyBirdListeningInterval.findMany({
            where: { accountId, synthetic: false, sourceCategory: 'beacon' },
            select: { startedAt: true, lastHeartbeatAt: true, endedAt: true }, take: 100_001,
        }),
    ]);
    const presentation = listenerMembershipPresentation(membership, now);
    const paidSource = membership?.source === 'PAYPAL' || membership?.source === 'MERCADO_PAGO';
    return {
        version: 1,
        identityKey: profileIdentityKey(subject.issuer, subject.subject),
        observedAt: now.toISOString(),
        listeningSeconds: intervals.length > 100_000 ? null : listeningSeconds(intervals, now),
        membership: presentation.kind === 'none' && paidSource ? { kind: 'unknown', state: 'unknown' } : presentation,
    };
}
