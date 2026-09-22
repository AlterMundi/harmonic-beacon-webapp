import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { digestSessionToken } from '@/lib/session-auth';
import { attachPublicSessionAccess } from '@/lib/public-session-access';

const integration = process.env.PUBLIC_SESSION_ACCESS_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const NOW = new Date('2026-09-22T14:00:00.000Z');
const SESSION_ID = '57000000-0000-4000-8000-000000000567';
const FACILITATOR_ID = '57000000-0000-4000-8000-000000000568';
const ISSUER = 'https://accounts.integration.invalid';
const DEVICE_COOKIES = [
    ...Array.from({ length: 8 }, (_, index) => `public-access-race-ana-${index}`),
    ...Array.from({ length: 4 }, (_, index) => `public-access-race-beto-${index}`),
];
const NEW_DEVICE_COOKIE = 'public-access-race-ana-new-device';
const ALL_COOKIES = [...DEVICE_COOKIES, NEW_DEVICE_COOKIE];

const publicSession = {
    id: SESSION_ID,
    scheduledAt: new Date('2026-09-22T16:00:00.000Z'),
    publicAccess: true,
};
let targetVerified = false;

function account(subject: string, displayName: string, email: string) {
    return {
        issuer: ISSUER,
        subject,
        sessionId: `central-${subject}`,
        displayName,
        email,
        emailVerified: true,
        profileComplete: true,
        validatedAt: NOW,
    };
}

async function cleanFixture() {
    await prisma.webSession.deleteMany({
        where: { tokenDigest: { in: ALL_COOKIES.map(digestSessionToken) } },
    });
    await prisma.sessionParticipant.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
    await prisma.ticketEntitlement.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
    await prisma.scheduledSession.deleteMany({ where: { id: SESSION_ID } });
    await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
}

integration('public session access PostgreSQL concurrency', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('public session access integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'public session access integration writes are restricted to the exact configured *_test database',
            );
        }
        targetVerified = true;

        await prisma.$executeRawUnsafe(
            'DROP TRIGGER IF EXISTS public_session_access_race_delay_trigger ON ticket_entitlements',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public_session_access_race_delay()');
        await cleanFixture();

        await prisma.user.create({
            data: {
                id: FACILITATOR_ID,
                email: 'public-access-race-facilitator@integration.invalid',
                name: 'Public access race facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: SESSION_ID,
                title: 'Public access race integration',
                roomName: 'public-access-race-integration',
                language: 'SPANISH',
                scheduledAt: publicSession.scheduledAt,
                status: 'LIVE',
                paidMode: true,
                publicAccess: true,
                facilitatorId: FACILITATOR_ID,
            },
        });
        await prisma.webSession.createMany({
            data: DEVICE_COOKIES.map((cookie, index) => {
                const ana = index < 8;
                const identity = ana
                    ? account('account-ana', 'Ana original', 'ana-original@integration.invalid')
                    : account('account-beto', 'Beto original', 'beto-original@integration.invalid');
                return {
                    tokenDigest: digestSessionToken(cookie),
                    accountIssuer: identity.issuer,
                    accountSubject: identity.subject,
                    accountSessionId: identity.sessionId,
                    accountDisplayName: identity.displayName,
                    accountEmail: identity.email,
                    accountEmailVerified: true,
                    accountProfileComplete: true,
                    accountValidatedAt: NOW,
                    expiresAt: new Date('2026-09-23T14:00:00.000Z'),
                };
            }),
        });

        // Widen the fresh-insert window so the regression is deterministic:
        // with update: {}, Prisma's SELECT + INSERT contenders hit P2002 on
        // code_digest; a database-native upsert waits and selects one winner.
        await prisma.$executeRawUnsafe(`
            CREATE FUNCTION public_session_access_race_delay()
            RETURNS trigger AS $$
            BEGIN
                IF NEW.scheduled_session_id = '${SESSION_ID}'::uuid THEN
                    PERFORM pg_sleep(0.1);
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
            CREATE TRIGGER public_session_access_race_delay_trigger
            BEFORE INSERT ON ticket_entitlements
            FOR EACH ROW EXECUTE FUNCTION public_session_access_race_delay()
        `);
    });

    afterAll(async () => {
        if (targetVerified) {
            await prisma.$executeRawUnsafe(
                'DROP TRIGGER IF EXISTS public_session_access_race_delay_trigger ON ticket_entitlements',
            );
            await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public_session_access_race_delay()');
            await cleanFixture();
        }
        await prisma.$disconnect();
    });

    it('converges tabs and devices by issuer/subject without merging people or rewriting history', async () => {
        const ana = account('account-ana', 'Ana original', 'ana-original@integration.invalid');
        const beto = account('account-beto', 'Beto original', 'beto-original@integration.invalid');

        const attached = await Promise.all(DEVICE_COOKIES.map((cookie, index) =>
            attachPublicSessionAccess(cookie, publicSession, index < 8 ? ana : beto, NOW),
        ));
        expect(attached.every(Boolean)).toBe(true);

        const entitlements = await prisma.ticketEntitlement.findMany({
            where: { scheduledSessionId: SESSION_ID, codeLastFour: 'FREE' },
            orderBy: { accountId: 'asc' },
        });
        expect(entitlements).toHaveLength(2);
        expect(entitlements.map(({ accountIssuer, accountId }) => ({ accountIssuer, accountId })))
            .toEqual([
                { accountIssuer: ISSUER, accountId: 'account-ana' },
                { accountIssuer: ISSUER, accountId: 'account-beto' },
            ]);

        const anaEntitlement = entitlements.find(({ accountId }) => accountId === 'account-ana');
        const betoEntitlement = entitlements.find(({ accountId }) => accountId === 'account-beto');
        if (!anaEntitlement || !betoEntitlement) throw new Error('expected both canonical entitlements');

        const sessions = await prisma.webSession.findMany({
            where: { tokenDigest: { in: DEVICE_COOKIES.map(digestSessionToken) } },
            select: { accountSubject: true, ticketEntitlementId: true },
        });
        expect(new Set(sessions.filter((row) => row.accountSubject === 'account-ana')
            .map((row) => row.ticketEntitlementId))).toEqual(new Set([anaEntitlement.id]));
        expect(new Set(sessions.filter((row) => row.accountSubject === 'account-beto')
            .map((row) => row.ticketEntitlementId))).toEqual(new Set([betoEntitlement.id]));

        await prisma.ticketEntitlement.update({
            where: { id: anaEntitlement.id },
            data: { accountEmail: 'historical-ana@integration.invalid', accountEmailVerified: true },
        });
        await prisma.webSession.update({
            where: { tokenDigest: digestSessionToken(DEVICE_COOKIES[0]) },
            data: { displayName: 'Chosen event alias', displayNameConfirmedAt: NOW },
        });
        await prisma.sessionParticipant.create({
            data: {
                scheduledSessionId: SESSION_ID,
                participantIdentity: 'public-access-race-ana',
                displayName: 'Chosen event alias',
                ticketEntitlementId: anaEntitlement.id,
            },
        });
        await prisma.webSession.create({
            data: {
                tokenDigest: digestSessionToken(NEW_DEVICE_COOKIE),
                accountIssuer: ISSUER,
                accountSubject: ana.subject,
                accountSessionId: 'central-account-ana-new-device',
                accountProfileComplete: true,
                accountValidatedAt: NOW,
                expiresAt: new Date('2026-09-23T14:00:00.000Z'),
            },
        });

        const changedAna = account(
            'account-ana',
            'Renamed account profile',
            'new-ana-address@integration.invalid',
        );
        await expect(Promise.all([
            attachPublicSessionAccess(DEVICE_COOKIES[0], publicSession, changedAna, NOW),
            attachPublicSessionAccess(NEW_DEVICE_COOKIE, publicSession, changedAna, NOW),
        ])).resolves.toEqual([true, true]);

        await expect(prisma.ticketEntitlement.findUniqueOrThrow({
            where: { id: anaEntitlement.id },
            select: { accountEmail: true, accountEmailVerified: true },
        })).resolves.toEqual({
            accountEmail: 'historical-ana@integration.invalid',
            accountEmailVerified: true,
        });
        const aliasSessions = await prisma.webSession.findMany({
            where: { tokenDigest: { in: [
                digestSessionToken(DEVICE_COOKIES[0]),
                digestSessionToken(NEW_DEVICE_COOKIE),
            ] } },
            select: { displayName: true },
        });
        expect(aliasSessions).toHaveLength(2);
        expect(aliasSessions.every(({ displayName }) => displayName === 'Chosen event alias')).toBe(true);
        expect(await prisma.ticketEntitlement.count({ where: { scheduledSessionId: SESSION_ID } })).toBe(2);
    });
});
