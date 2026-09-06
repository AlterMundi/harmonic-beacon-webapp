import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { principalFromToken } from '@/lib/principal';
import {
    digestPromoCode,
    redeemPromoInvitation,
} from '@/lib/promo-invitation';

const integration = process.env.COMMERCE_INTEGRATION_TEST === '1' ? describe : describe.skip;
const PEPPER = 'promo-integration-pepper-at-least-32-characters';
const NOW = new Date('2026-08-02T12:00:00.000Z');
const SESSION_ID = '10000000-0000-4000-8000-000000000011';
const ISSUER_ID = '10000000-0000-4000-8000-000000000099';
const CAMPAIGN_ID = '50000000-0000-4000-8000-000000000001';

integration('promotion invitation PostgreSQL contract', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('promotion integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error('promotion integration cleanup is restricted to the exact configured *_test database');
        }
        vi.stubEnv('TICKET_CODE_PEPPER', PEPPER);
        await prisma.auditLog.deleteMany();
        await prisma.promoRedemption.deleteMany();
        await prisma.promoInvitation.deleteMany();
        await prisma.commerceRequestReceipt.deleteMany();
        await prisma.commerceEntitlementCommand.deleteMany();
        await prisma.commerceMediaOutbox.deleteMany();
        await prisma.stageGrantEffectOutbox.deleteMany();
        await prisma.commerceEntitlement.deleteMany();
        await prisma.webSession.deleteMany();
        await prisma.sessionParticipant.deleteMany();
        await prisma.ticketEntitlement.deleteMany();
        await prisma.scheduledSession.deleteMany();
        await prisma.user.deleteMany();
        await prisma.user.create({
            data: {
                id: ISSUER_ID,
                email: 'promo-issuer@integration.invalid',
                name: 'Promotion issuer',
                role: 'FACILITATOR_OP',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: SESSION_ID,
                title: 'Promotion integration',
                roomName: 'promo-integration',
                language: 'SPANISH',
                scheduledAt: new Date('2026-08-08T14:30:00.000Z'),
                status: 'LIVE',
                paidMode: true,
                attendeeCap: 150,
                facilitatorId: ISSUER_ID,
            },
        });
        await prisma.promoInvitation.create({
            data: {
                id: CAMPAIGN_ID,
                scheduledSessionId: SESSION_ID,
                codeDigest: digestPromoCode('NICO100', PEPPER),
                label: 'Synthetic guest campaign',
                expiresAt: new Date('2026-08-03T12:00:00.000Z'),
                maxRedemptions: 1,
                issuedByUserId: ISSUER_ID,
            },
        });
    });

    afterAll(async () => {
        vi.unstubAllEnvs();
        await prisma.$disconnect();
    });

    it('serializes the last slot, creates a normal entitlement, and never audits raw material', async () => {
        const [ana, beto] = await Promise.all([
            redeemPromoInvitation('nico100', 'ana@example.com', 'Ana', NOW),
            redeemPromoInvitation('NICO100', 'beto@example.com', 'Beto', NOW),
        ]);
        const winner = ana.ok ? ana : beto;
        const loser = ana.ok ? beto : ana;

        expect(winner.ok).toBe(true);
        expect(loser).toEqual({ ok: false, reason: 'unavailable' });
        if (!winner.ok) throw new Error('expected one winner');

        await expect(prisma.promoInvitation.findUniqueOrThrow({
            where: { id: CAMPAIGN_ID },
        })).resolves.toMatchObject({ redemptionCount: 1, maxRedemptions: 1 });
        await expect(prisma.ticketEntitlement.findUniqueOrThrow({
            where: { id: winner.entitlementId },
            include: { promoRedemption: true, commerceEntitlement: true },
        })).resolves.toMatchObject({
            scheduledSessionId: SESSION_ID,
            tier: 'COMP',
            state: 'BOUND',
            promoRedemption: { promoInvitationId: CAMPAIGN_ID },
            commerceEntitlement: null,
        });
        await expect(principalFromToken(winner.cookieValue, NOW)).resolves.toMatchObject({
            kind: 'attendee',
            scheduledSessionId: SESSION_ID,
            entitlementId: winner.entitlementId,
            tier: 'COMP',
        });

        const audits = JSON.stringify(await prisma.auditLog.findMany());
        expect(audits).toContain('promo.redeem');
        expect(audits).not.toMatch(/nico100|ana@example|beto@example/i);
    });

    it('replays the winner after campaign expiry/disable but rejects a shared new identity', async () => {
        const redemption = await prisma.promoRedemption.findFirstOrThrow({
            include: { ticketEntitlement: true },
        });
        await prisma.promoInvitation.update({
            where: { id: CAMPAIGN_ID },
            data: { status: 'DISABLED', disabledAt: NOW },
        });

        const replay = await redeemPromoInvitation(
            'NICO100',
            redemption.ticketEntitlement.boundEmail!,
            'Returning guest',
            new Date('2026-08-04T12:00:00.000Z'),
            {
                version: 'personal-invitation-v2',
                acceptedAt: new Date('2026-08-04T12:00:00.000Z'),
            },
        );
        expect(replay).toMatchObject({
            ok: true,
            entitlementId: redemption.ticketEntitlementId,
            replayed: true,
        });
        await expect(redeemPromoInvitation(
            'NICO100',
            'shared@example.com',
            'Shared code',
            new Date('2026-08-04T12:00:00.000Z'),
        )).resolves.toEqual({ ok: false, reason: 'unavailable' });
        expect(await prisma.ticketEntitlement.count()).toBe(1);
        await expect(prisma.auditLog.findFirst({
            where: {
                action: 'invitation.terms.accept',
                targetId: redemption.ticketEntitlementId,
            },
        })).resolves.toMatchObject({
            metadata: {
                promoInvitationId: CAMPAIGN_ID,
                termsVersion: 'personal-invitation-v2',
                acceptedAt: '2026-08-04T12:00:00.000Z',
            },
        });
    });

    it('binds an Account invitation to issuer plus opaque subject without an email', async () => {
        const issuer = 'https://account.harmonicbeacon.com';
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'true');
        vi.stubEnv('BEACON_ACCOUNT_ISSUER_URL', issuer);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_ID', 'hb-live');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET', 'integration-secret-that-is-at-least-32-characters');
        await prisma.promoInvitation.create({
            data: {
                id: '50000000-0000-4000-8000-000000000002',
                scheduledSessionId: SESSION_ID,
                codeDigest: digestPromoCode('ACCT100', PEPPER),
                label: 'Synthetic Account guest campaign',
                expiresAt: new Date('2026-08-03T12:00:00.000Z'),
                maxRedemptions: 1,
                issuedByUserId: ISSUER_ID,
            },
        });
        const account = {
            issuer,
            subject: 'acct_opaque_integration_1',
            sessionId: 'central-device-integration-1',
            displayName: 'Account profile',
            email: 'account-profile@example.com',
            emailVerified: true as const,
            authMethod: 'google' as const,
            validatedAt: NOW,
        };
        const result = await redeemPromoInvitation(
            'ACCT100',
            { accountIssuer: issuer, accountId: account.subject },
            'Event alias',
            NOW,
            undefined,
            account,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected Account invitation redemption');

        await expect(prisma.ticketEntitlement.findUniqueOrThrow({
            where: { id: result.entitlementId },
        })).resolves.toMatchObject({
            state: 'BOUND',
            boundEmail: null,
            accountIssuer: issuer,
            accountId: account.subject,
        });
        await expect(principalFromToken(result.cookieValue, NOW)).resolves.toMatchObject({
            kind: 'attendee',
            accountId: account.subject,
            scheduledSessionId: SESSION_ID,
        });
    });
});
