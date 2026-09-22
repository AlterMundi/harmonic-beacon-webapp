import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillAccountAttendanceEmail } from '../backfill-account-attendance-email';

const enabled = process.env.ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_INTEGRATION_TEST === '1';
const databaseUrl = process.env.DATABASE_URL ?? '';
const suite = enabled ? describe : describe.skip;
const issuer = 'https://account.backfill.integration.invalid';
const run = randomUUID();
const facilitatorId = randomUUID();
const publicSessionId = randomUUID();
const privateSessionId = randomUUID();
const testSessionId = randomUUID();
const otherIssuer = 'https://other-account.backfill.integration.invalid';
const subjects = {
    unique: `backfill-unique-${run}`,
    secondUnique: `backfill-second-unique-${run}`,
    ambiguous: `backfill-ambiguous-${run}`,
    unverified: `backfill-unverified-${run}`,
    overLimit: `backfill-over-limit-${run}`,
    existing: `backfill-existing-${run}`,
    private: `backfill-private-${run}`,
    testFixture: `backfill-test-fixture-${run}`,
    otherIssuer: `backfill-other-issuer-${run}`,
};
const ticketIds = Object.fromEntries(Object.keys(subjects).map(key => [key, randomUUID()])) as Record<keyof typeof subjects, string>;

let pool: Pool;
let prisma: PrismaClient;

function digest(label: string) {
    return createHash('sha256').update(`${run}:${label}`).digest('hex');
}

suite('Account attendance email backfill PostgreSQL contract', () => {
    beforeAll(async () => {
        const parsed = new URL(databaseUrl);
        if (!parsed.pathname.endsWith('_test') && parsed.pathname !== '/beacon_test') {
            throw new Error('attendance email backfill integration test refuses a non-test database');
        }
        pool = new Pool({ connectionString: databaseUrl, max: 4 });
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

        await prisma.user.create({
            data: {
                id: facilitatorId,
                email: `backfill-${run}@integration.invalid`,
                name: 'Backfill integration facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'synthetic-not-a-login-secret',
            },
        });
        await prisma.scheduledSession.createMany({ data: [
            {
                id: publicSessionId, title: 'Public backfill fixture', roomName: `backfill-public-${run}`,
                language: 'ENGLISH', scheduledAt: new Date('2026-09-21T18:00:00Z'), status: 'ENDED',
                publicAccess: true, facilitatorId,
            },
            {
                id: privateSessionId, title: 'Private backfill fixture', roomName: `backfill-private-${run}`,
                language: 'ENGLISH', scheduledAt: new Date('2026-09-21T18:00:00Z'), status: 'ENDED',
                publicAccess: false, facilitatorId,
            },
            {
                id: testSessionId, title: 'Test-session backfill fixture', roomName: `backfill-test-${run}`,
                language: 'ENGLISH', scheduledAt: new Date('2026-09-21T18:00:00Z'), status: 'ENDED',
                publicAccess: true, isTest: true, facilitatorId,
            },
        ] });
        const expiresAt = new Date('2026-09-22T18:00:00Z');
        await prisma.ticketEntitlement.createMany({
            data: Object.entries(subjects).map(([key, accountId]) => ({
                id: ticketIds[key as keyof typeof subjects],
                scheduledSessionId: key === 'private'
                    ? privateSessionId
                    : key === 'testFixture' ? testSessionId : publicSessionId,
                codeDigest: digest(`ticket:${key}`), codeLastFour: 'FREE', tier: 'COMP', state: 'BOUND',
                accountIssuer: key === 'otherIssuer' ? otherIssuer : issuer,
                accountId, boundAt: new Date('2026-09-21T17:00:00Z'), expiresAt,
                ...(key === 'existing' ? {
                    accountEmail: 'preserve-existing@example.test', accountEmailVerified: true,
                } : {}),
            })),
        });

        const sourceRows = [
            [issuer, subjects.unique, 'unique@example.test', true],
            [issuer, subjects.unique, 'unique@example.test', true],
            [issuer, subjects.secondUnique, 'second-unique@example.test', true],
            [issuer, subjects.ambiguous, 'first@example.test', true],
            [issuer, subjects.ambiguous, 'second@example.test', true],
            [issuer, subjects.unverified, 'unverified@example.test', false],
            [issuer, subjects.overLimit, `${'a'.repeat(243)}@example.test`, true],
            [issuer, subjects.existing, 'replacement@example.test', true],
            [issuer, subjects.private, 'private@example.test', true],
            [issuer, subjects.testFixture, 'test-fixture@example.test', true],
            [otherIssuer, subjects.otherIssuer, 'other-issuer@example.test', true],
        ] as const;
        await prisma.webSession.createMany({
            data: sourceRows.map(([accountIssuer, accountSubject, accountEmail, accountEmailVerified], index) => ({
                tokenDigest: digest(`session:${index}`),
                accountIssuer, accountSubject, accountSessionId: `sid-${run}-${index}`,
                accountEmail, accountEmailVerified, accountValidatedAt: new Date('2026-09-21T17:30:00Z'),
                expiresAt, lastSeenAt: new Date('2026-09-21T17:30:00Z'),
            })),
        });
        const participantIds = {
            first: randomUUID(),
            second: randomUUID(),
            test: randomUUID(),
        };
        await prisma.sessionParticipant.createMany({ data: [
            {
                id: participantIds.first, scheduledSessionId: publicSessionId,
                participantIdentity: `backfill-participant-first-${run}`,
                displayName: 'First synthetic attendee', ticketEntitlementId: ticketIds.unique,
            },
            {
                id: participantIds.second, scheduledSessionId: publicSessionId,
                participantIdentity: `backfill-participant-second-${run}`,
                // The database permits only one participant per session/entitlement.
                displayName: 'Second synthetic attendee', ticketEntitlementId: ticketIds.secondUnique,
            },
            {
                id: participantIds.test, scheduledSessionId: testSessionId,
                participantIdentity: `backfill-participant-test-${run}`,
                displayName: 'Test synthetic attendee', ticketEntitlementId: ticketIds.testFixture,
            },
        ] });
        await prisma.livePresenceInterval.createMany({ data: [
            {
                scheduledSessionId: publicSessionId, participantId: participantIds.first, generation: 1,
                startedAt: new Date('2026-09-21T17:45:00Z'), lastHeartbeatAt: new Date('2026-09-21T17:46:00Z'),
                endedAt: new Date('2026-09-21T17:46:00Z'),
            },
            {
                scheduledSessionId: publicSessionId, participantId: participantIds.first, generation: 2,
                startedAt: new Date('2026-09-21T17:47:00Z'), lastHeartbeatAt: new Date('2026-09-21T17:48:00Z'),
                endedAt: new Date('2026-09-21T17:48:00Z'), reconnectCount: 1,
            },
            {
                scheduledSessionId: publicSessionId, participantId: participantIds.second, generation: 1,
                startedAt: new Date('2026-09-21T17:49:00Z'), lastHeartbeatAt: new Date('2026-09-21T17:50:00Z'),
                endedAt: new Date('2026-09-21T17:50:00Z'),
            },
            {
                scheduledSessionId: testSessionId, participantId: participantIds.test, generation: 1,
                startedAt: new Date('2026-09-21T17:51:00Z'), lastHeartbeatAt: new Date('2026-09-21T17:52:00Z'),
                endedAt: new Date('2026-09-21T17:52:00Z'),
            },
        ] });
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.webSession.deleteMany({ where: { accountSubject: { in: Object.values(subjects) } } });
        await prisma.scheduledSession.deleteMany({ where: { id: { in: [publicSessionId, privateSessionId, testSessionId] } } });
        await prisma.user.deleteMany({ where: { id: facilitatorId } });
        await prisma.$disconnect();
        await pool.end();
    });

    it('dry-runs, updates only one unambiguous target, and replays as a no-op', async () => {
        await expect(backfillAccountAttendanceEmail(prisma, { accountIssuer: issuer })).resolves.toMatchObject({
            mode: 'dry-run', outcome: 'would-update', updatedCount: 0,
            before: {
                targetCount: 6, wouldUpdateCount: 3, noVerifiedSourceCount: 1,
                ambiguousSourceCount: 1, overLimitSourceCount: 1, affectedFeedEntryCount: 2,
            },
        });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.unique } })).accountEmail)
            .toBeNull();

        await expect(backfillAccountAttendanceEmail(prisma, { apply: true, accountIssuer: issuer })).resolves.toMatchObject({
            mode: 'apply', outcome: 'updated', updatedCount: 3,
            after: { targetCount: 3, wouldUpdateCount: 0 },
        });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.unique } })))
            .toMatchObject({ accountEmail: 'unique@example.test', accountEmailVerified: true });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.secondUnique } })))
            .toMatchObject({ accountEmail: 'second-unique@example.test', accountEmailVerified: true });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.testFixture } })))
            .toMatchObject({ accountEmail: 'test-fixture@example.test', accountEmailVerified: true });
        for (const key of ['ambiguous', 'unverified', 'overLimit', 'private', 'otherIssuer'] as const) {
            expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds[key] } })).accountEmail)
                .toBeNull();
        }
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.existing } })))
            .toMatchObject({ accountEmail: 'preserve-existing@example.test', accountEmailVerified: true });

        await expect(backfillAccountAttendanceEmail(prisma, { apply: true, accountIssuer: issuer })).resolves.toMatchObject({
            mode: 'apply', outcome: 'no-op', updatedCount: 0,
        });
    });
});
