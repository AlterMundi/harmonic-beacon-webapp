import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { currentAccountIdentity, currentPrincipal } from '@/lib/principal';
import { beaconAccountEnabled } from '@/lib/account-rp';
import { measuredPresenceSeconds } from '@/lib/profile-time';

export async function resolveLiveProfile() {
    const account = beaconAccountEnabled() ? await currentAccountIdentity() : null;
    const principal = await currentPrincipal();
    if (!account && !principal) return null;
    const legacyName = !account && principal?.kind === 'attendee'
        ? (await prisma.webSession.findUnique({
            where: { id: principal.webSessionId }, select: { displayName: true },
        }))?.displayName : null;
    const staff = principal?.kind === 'staff'
        ? await prisma.user.findUnique({ where: { id: principal.userId }, select: { id: true, name: true, role: true, disabledAt: true } })
        : account ? (await prisma.staffAccountBinding.findUnique({
            where: { accountIssuer_accountSubject: { accountIssuer: account.issuer, accountSubject: account.subject } },
            select: { disabledAt: true, staffUser: { select: { id: true, name: true, role: true, disabledAt: true } } },
        }).then(binding => binding && !binding.disabledAt ? binding.staffUser : null)) : null;
    const activeStaff = staff && !staff.disabledAt ? staff : null;
    const ownTickets = account
        ? { accountIssuer: account.issuer, accountId: account.subject }
        : principal?.kind === 'attendee' ? { id: principal.entitlementId } : null;
    // Current role is never inferred from an email, profile field or browser flag.
    const participantFilter = { OR: [
        ...(activeStaff ? [{ staffUserId: activeStaff.id }] : []),
        ...(ownTickets ? [{ ticketEntitlement: ownTickets }] : []),
    ] };
    const now = new Date();
    const [presence, events] = await Promise.allSettled([
        prisma.livePresenceInterval.findMany({
            where: { participant: participantFilter, scheduledSession: { isTest: false } },
            select: { startedAt: true, lastHeartbeatAt: true, endedAt: true },
            // Explicitly report incomplete data rather than silently truncating a lifetime counter.
            take: 100_001,
        }),
        prisma.scheduledSession.findMany({
            where: { isTest: false, isPublished: true, endedAt: null, OR: [
                { status: 'SCHEDULED', scheduledAt: { gte: now } },
                { status: 'LIVE', startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
            ] },
            orderBy: { scheduledAt: 'asc' }, take: 100,
            select: { id: true, title: true, status: true, scheduledAt: true, publicAccess: true, language: true },
        }),
    ]);
    return {
        identityKey: account ? createHash('sha256').update(`hb-profile-v1\0${account.issuer}\0${account.subject}`).digest('hex') : null,
        name: account?.displayName || activeStaff?.name || legacyName || null,
        role: activeStaff?.role ?? null,
        staffActive: principal?.kind === 'staff',
        seconds: presence.status === 'fulfilled' && presence.value.length <= 100_000
            ? measuredPresenceSeconds(presence.value, now) : null,
        events: events.status === 'fulfilled' ? events.value : null,
    };
}
