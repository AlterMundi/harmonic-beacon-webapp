import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, entitlementUpsert, webSessionUpdateMany, findSession, findParticipant, fillEmail, currentEvent } = vi.hoisted(() => ({
    currentEvent:vi.fn(),
    transaction: vi.fn(),
    entitlementUpsert: vi.fn(),
    webSessionUpdateMany: vi.fn(),
    findSession: vi.fn(),
    findParticipant: vi.fn(),
    fillEmail: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: { $transaction: transaction },
}));

const account = {
    issuer: 'https://account.harmonicbeacon.com',
    subject: 'account-person-1',
    sessionId: 'central-session-1',
    displayName: '  Sai  ',
    profileComplete: true,
    validatedAt: new Date('2026-08-18T12:00:00Z'),
};
const publicSession = {
    id: '50000000-0000-4000-8000-202608220001',
    scheduledAt: new Date('2026-08-22T16:00:00Z'),
    publicAccess: true,
};

describe('attachPublicSessionAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        entitlementUpsert.mockResolvedValue({ id: 'free-entitlement-1' });
        webSessionUpdateMany.mockResolvedValue({ count: 1 });
        findSession.mockResolvedValue(null);
        findParticipant.mockResolvedValue(null);
        currentEvent.mockResolvedValue({publicAccess:true,isPublished:true,isTest:false,status:'SCHEDULED'});
        transaction.mockImplementation(async (work) => work({
            $queryRaw:vi.fn(),
            scheduledSession:{findUnique:currentEvent},
            ticketEntitlement: { upsert: entitlementUpsert, updateMany: fillEmail },
            webSession: { updateMany: webSessionUpdateMany, findUnique: findSession },
            sessionParticipant: { findFirst: findParticipant },
        }));
    });

    it('rechecks publication inside the transaction before issuing access',async()=>{
        currentEvent.mockResolvedValue({publicAccess:true,isPublished:false,isTest:false,status:'SCHEDULED'});
        const {attachPublicSessionAccess}=await import('../public-session-access');
        expect(await attachPublicSessionAccess('cookie',publicSession,account)).toBe(false);
        expect(entitlementUpsert).not.toHaveBeenCalled();
    });

    it('does nothing for a session that is not explicitly public', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        await expect(attachPublicSessionAccess(
            'opaque-cookie',
            { ...publicSession, publicAccess: false },
            account,
        )).resolves.toBe(false);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('does not create an entitlement for an incomplete profile', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        expect(await attachPublicSessionAccess('cookie', publicSession, { ...account, profileComplete: false })).toBe(false);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('creates account-bound complimentary access and attaches only its active web session', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        const now = new Date('2026-08-18T13:00:00Z');

        await expect(attachPublicSessionAccess(
            'opaque-cookie',
            publicSession,
            account,
            now,
        )).resolves.toBe(true);

        expect(entitlementUpsert).toHaveBeenCalledWith(expect.objectContaining({
            update: { codeDigest: expect.any(String) },
            create: expect.objectContaining({
                scheduledSessionId: publicSession.id,
                codeLastFour: 'FREE',
                tier: 'COMP',
                state: 'BOUND',
                accountId: account.subject,
                accountIssuer: account.issuer,
                boundAt: now,
                expiresAt: new Date('2026-08-23T16:00:00Z'),
            }),
        }));
        const upsert = entitlementUpsert.mock.calls[0][0];
        expect(upsert.update.codeDigest).toBe(upsert.where.codeDigest);
        expect(upsert.update.codeDigest).toBe(upsert.create.codeDigest);
        expect(webSessionUpdateMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                accountIssuer: account.issuer,
                accountSubject: account.subject,
                staffUserId: null,
                revokedAt: null,
                expiresAt: { gt: now },
            }),
            data: {
                ticketEntitlementId: 'free-entitlement-1',
                displayName: 'Sai',
                displayNameConfirmedAt: now,
                lastSeenAt: now,
            },
        });
        expect(webSessionUpdateMany.mock.calls[0][0].where.tokenDigest).not.toContain('opaque-cookie');
    });

    it('fails closed when the authenticated web session changed concurrently', async () => {
        webSessionUpdateMany.mockResolvedValue({ count: 0 });
        const { attachPublicSessionAccess } = await import('../public-session-access');
        await expect(attachPublicSessionAccess(
            'opaque-cookie',
            publicSession,
            account,
        )).resolves.toBe(false);
    });

    it('uses the completed preferred name without another alias question', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        const now = new Date();
        await attachPublicSessionAccess('cookie', publicSession, { ...account, profileComplete: true }, now);
        expect(webSessionUpdateMany.mock.calls[0][0].data).toMatchObject({ displayName: 'Sai', displayNameConfirmedAt: now });
    });

    it('fills missing email only for the exact Account-bound entitlement', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        await attachPublicSessionAccess('cookie', publicSession, { ...account, email: 'synthetic@example.test', emailVerified: true });
        expect(fillEmail).toHaveBeenCalledWith({
            where: { id: 'free-entitlement-1', accountIssuer: account.issuer, accountId: account.subject, accountEmail: null },
            data: { accountEmail: 'synthetic@example.test', accountEmailVerified: true },
        });
        fillEmail.mockClear();
        await attachPublicSessionAccess('cookie', publicSession, { ...account, email: 'synthetic@example.test', emailVerified: false });
        expect(fillEmail).not.toHaveBeenCalled();
    });

    it('preserves a chosen event alias when the Account preferred name changes', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        const confirmed = new Date('2026-08-18T12:30:00Z');
        findSession.mockResolvedValue({ ticketEntitlementId: 'free-entitlement-1', displayName: 'Event alias', displayNameConfirmedAt: confirmed });
        await attachPublicSessionAccess('cookie', publicSession, { ...account, profileComplete: true });
        expect(webSessionUpdateMany.mock.calls[0][0].data).toMatchObject({ displayName: 'Event alias', displayNameConfirmedAt: confirmed });
    });

    it('restores the historical event alias on a new device without renaming participation', async () => {
        const { attachPublicSessionAccess } = await import('../public-session-access');
        findParticipant.mockResolvedValue({ displayName: 'Historical alias' });
        await attachPublicSessionAccess('new-device', publicSession, { ...account, profileComplete: true });
        expect(webSessionUpdateMany.mock.calls[0][0].data.displayName).toBe('Historical alias');
        expect(entitlementUpsert.mock.calls[0][0].update).toEqual({
            codeDigest: entitlementUpsert.mock.calls[0][0].where.codeDigest,
        });
    });
});
