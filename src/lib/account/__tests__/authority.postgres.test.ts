import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseURL = process.env.LISTENER_TEST_DATABASE_URL;
if (databaseURL) process.env.DATABASE_URL = databaseURL;
const postgres = databaseURL ? describe : describe.skip;

let prisma: PrismaClient;
const suffix = randomUUID();
const firstId = `account-authority-first-${suffix}`;
const secondId = `account-authority-second-${suffix}`;
const tokenValue = `${'A'.repeat(43)}_${suffix.replaceAll('-', '').slice(0, 8)}`;

postgres('Account authority PostgreSQL invariants', () => {
    beforeAll(async () => {
        ({ prisma } = await import('@/lib/db'));
        await prisma.earlyBirdUser.createMany({ data: [
            { id: firstId, name: 'First', email: `first-${suffix}@example.invalid`, emailVerified: true },
            { id: secondId, name: 'Second', email: `second-${suffix}@example.invalid`, emailVerified: true },
        ] });
        await prisma.earlyBirdIdentity.createMany({ data: [
            { id: randomUUID(), providerId: 'credential', accountId: firstId, userId: firstId, password: 'fixture' },
            { id: randomUUID(), providerId: 'credential', accountId: secondId, userId: secondId, password: 'fixture' },
        ] });
    });

    afterAll(async () => {
        await prisma.earlyBirdUser.deleteMany({ where: { id: { in: [firstId, secondId] } } });
        await prisma.beaconAccountAuthThrottle.deleteMany({
            where: { kind: { startsWith: `pg-${suffix}` } },
        });
        await prisma.$disconnect();
    });

    it('enforces one fixed access method below the auth handler', async () => {
        await expect(prisma.earlyBirdIdentity.create({ data: {
            id: randomUUID(), providerId: 'google', accountId: `google-${suffix}`,
            userId: firstId,
        } })).rejects.toThrow();
        expect(await prisma.earlyBirdIdentity.count({ where: { userId: firstId } })).toBe(1);
    });

    it('creates a provider-independent profile at the database boundary', async () => {
        expect(await prisma.beaconProfile.findUnique({ where: { accountId: firstId } }))
            .toMatchObject({ displayName: 'First', revision: 1 });
    });

    it('rejects provider bearer-token persistence below ORM hooks', async () => {
        await expect(prisma.earlyBirdIdentity.update({
            where: { providerId_accountId: { providerId: 'credential', accountId: firstId } },
            data: { accessToken: 'must-never-persist' },
        })).rejects.toThrow();
    });

    it('rolls token consumption back when the exact email mutation conflicts', async () => {
        const { digestAccountActionToken } = await import('../action-tokens');
        const { confirmEmailChange } = await import('../credential-actions');
        await prisma.beaconAccountActionToken.create({ data: {
            tokenDigest: digestAccountActionToken(tokenValue),
            accountId: firstId,
            purpose: 'change_email',
            targetEmail: `second-${suffix}@example.invalid`,
            expiresAt: new Date(Date.now() + 60_000),
        } });
        await expect(confirmEmailChange(tokenValue)).resolves.toBe(false);
        expect(await prisma.beaconAccountActionToken.findUniqueOrThrow({
            where: { tokenDigest: digestAccountActionToken(tokenValue) },
        })).toMatchObject({ consumedAt: null });
    });

    it('admits at most one concurrent request into a one-attempt durable bucket', async () => {
        const { consumeAccountRateLimit } = await import('../rate-limit');
        const input = {
            request: new Request('https://account.harmonicbeacon.com/account', {
                headers: { origin: 'https://account.harmonicbeacon.com', 'x-real-ip': '192.0.2.1' },
            }),
            email: `distributed-${suffix}@example.invalid`,
            purpose: `pg-${suffix}`,
            secret: `rate-${suffix}-secret-that-is-long-enough`,
            maxPerEmail: 1,
            maxPerOrigin: 100,
            maxGlobal: 100,
        };
        const outcomes = await Promise.all([
            consumeAccountRateLimit(input),
            consumeAccountRateLimit(input),
        ]);
        expect(outcomes.sort()).toEqual([false, true]);
    });

    it('short-circuits blocked low-cardinality buckets and cleans expired throttle rows', async () => {
        const { consumeAccountRateLimit } = await import('../rate-limit');
        const { cleanupAccountAuthorityRecords } = await import('../maintenance');
        const purpose = `pg-${suffix}-spray`;
        const base = {
            request: new Request('https://account.harmonicbeacon.com/account', {
                headers: { origin: 'https://account.harmonicbeacon.com', 'x-real-ip': '192.0.2.55' },
            }),
            purpose,
            secret: `rate-${suffix}-secret-that-is-long-enough`,
            maxPerEmail: 50,
            maxPerOrigin: 1,
            maxGlobal: 100,
        };
        expect(await consumeAccountRateLimit({ ...base, email: 'first@example.invalid' })).toBe(true);
        for (let index = 0; index < 8; index += 1) {
            expect(await consumeAccountRateLimit({
                ...base, email: `rotated-${index}@example.invalid`,
            })).toBe(false);
        }
        expect(await prisma.beaconAccountAuthThrottle.count({
            where: { kind: { startsWith: purpose } },
        })).toBe(3);

        await prisma.beaconAccountAuthThrottle.updateMany({
            where: { kind: { startsWith: purpose } },
            data: { updatedAt: new Date('2026-08-01T00:00:00.000Z'), blockedUntil: null },
        });
        await cleanupAccountAuthorityRecords(new Date('2026-08-18T00:00:00.000Z'));
        expect(await prisma.beaconAccountAuthThrottle.count({
            where: { kind: { startsWith: purpose } },
        })).toBe(0);
    });

    it('does not leave an old-password sign-in session alive when a revision mutation wins the interleaving', async () => {
        const before = await prisma.earlyBirdUser.findUniqueOrThrow({
            where: { id: firstId }, select: { securityRevision: true },
        });
        const staleSessionId = randomUUID();
        await prisma.earlyBirdAuthSession.create({ data: {
            id: staleSessionId,
            userId: firstId,
            token: `stale-sign-in-${suffix}`,
            expiresAt: new Date(Date.now() + 60_000),
            securityRevision: before.securityRevision,
            authorityEnvironment: 'https://account.harmonicbeacon.com',
        } });

        // The credential handler captured `before`; reset/change then wins the
        // account-row serialization point and revokes the just-created session.
        await prisma.$transaction(async (transaction) => {
            await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${firstId} FOR UPDATE`;
            await transaction.earlyBirdUser.update({
                where: { id: firstId }, data: { securityRevision: { increment: 1 } },
            });
            await transaction.earlyBirdAuthSession.deleteMany({ where: { userId: firstId } });
        });

        const fenceAccepted = await prisma.$transaction(async (transaction) => {
            await transaction.$queryRaw`SELECT "id" FROM "early_bird_users" WHERE "id" = ${firstId} FOR UPDATE`;
            const [user, session] = await Promise.all([
                transaction.earlyBirdUser.findUniqueOrThrow({
                    where: { id: firstId }, select: { securityRevision: true },
                }),
                transaction.earlyBirdAuthSession.findUnique({
                    where: { id: staleSessionId }, select: { securityRevision: true },
                }),
            ]);
            return Boolean(session && session.securityRevision === before.securityRevision &&
                user.securityRevision === before.securityRevision);
        });
        expect(fenceAccepted).toBe(false);
        expect(await prisma.earlyBirdAuthSession.findUnique({ where: { id: staleSessionId } })).toBeNull();
    });

    it('keeps claimed outbox generations immutable and gives signup locale enrichment a five-second grace', async () => {
        const { queueAccountActionMail } = await import('../mail-outbox');
        const first = await prisma.beaconAccountMailOutbox.findFirstOrThrow({
            where: { accountId: secondId, purpose: 'verify_email' },
            orderBy: { generation: 'desc' },
        });
        expect(first.nextAttemptAt.getTime() - first.createdAt.getTime()).toBeGreaterThanOrEqual(4_900);
        expect(first.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

        const claimedAt = new Date();
        await prisma.beaconAccountMailOutbox.update({
            where: { id: first.id }, data: { lockedAt: claimedAt },
        });
        await queueAccountActionMail({
            accountId: secondId,
            purpose: 'verify_email',
            recipient: `second-${suffix}@example.invalid`,
            locale: 'es',
        });

        const generations = await prisma.beaconAccountMailOutbox.findMany({
            where: { accountId: secondId, purpose: 'verify_email' },
            orderBy: { generation: 'asc' },
        });
        expect(generations).toHaveLength(2);
        expect(generations[0]).toMatchObject({
            id: first.id, generation: first.generation, locale: 'en', lockedAt: claimedAt,
        });
        expect(generations[1]).toMatchObject({ generation: first.generation + 1, locale: 'es' });

        await prisma.beaconAccountMailOutbox.deleteMany({
            where: { id: first.id, generation: first.generation },
        });
        expect(await prisma.beaconAccountMailOutbox.findFirst({
            where: { accountId: secondId, purpose: 'verify_email', generation: first.generation + 1 },
        })).not.toBeNull();
    });
});
