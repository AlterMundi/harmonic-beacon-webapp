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
const subjects = {
    unique: `backfill-unique-${run}`,
    ambiguous: `backfill-ambiguous-${run}`,
    unverified: `backfill-unverified-${run}`,
    overLimit: `backfill-over-limit-${run}`,
    existing: `backfill-existing-${run}`,
    private: `backfill-private-${run}`,
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
        ] });
        const expiresAt = new Date('2026-09-22T18:00:00Z');
        await prisma.ticketEntitlement.createMany({
            data: Object.entries(subjects).map(([key, accountId]) => ({
                id: ticketIds[key as keyof typeof subjects],
                scheduledSessionId: key === 'private' ? privateSessionId : publicSessionId,
                codeDigest: digest(`ticket:${key}`), codeLastFour: 'FREE', tier: 'COMP', state: 'BOUND',
                accountIssuer: issuer, accountId, boundAt: new Date('2026-09-21T17:00:00Z'), expiresAt,
                ...(key === 'existing' ? {
                    accountEmail: 'preserve-existing@example.test', accountEmailVerified: true,
                } : {}),
            })),
        });

        const sourceRows = [
            [subjects.unique, 'unique@example.test', true],
            [subjects.unique, 'unique@example.test', true],
            [subjects.ambiguous, 'first@example.test', true],
            [subjects.ambiguous, 'second@example.test', true],
            [subjects.unverified, 'unverified@example.test', false],
            [subjects.overLimit, `${'a'.repeat(243)}@example.test`, true],
            [subjects.existing, 'replacement@example.test', true],
            [subjects.private, 'private@example.test', true],
        ] as const;
        await prisma.webSession.createMany({
            data: sourceRows.map(([accountSubject, accountEmail, accountEmailVerified], index) => ({
                tokenDigest: digest(`session:${index}`),
                accountIssuer: issuer, accountSubject, accountSessionId: `sid-${run}-${index}`,
                accountEmail, accountEmailVerified, accountValidatedAt: new Date('2026-09-21T17:30:00Z'),
                expiresAt, lastSeenAt: new Date('2026-09-21T17:30:00Z'),
            })),
        });
        const participant = await prisma.sessionParticipant.create({
            data: {
                scheduledSessionId: publicSessionId, participantIdentity: `backfill-participant-${run}`,
                displayName: 'Synthetic attendee', ticketEntitlementId: ticketIds.unique,
            },
        });
        await prisma.livePresenceInterval.create({
            data: {
                scheduledSessionId: publicSessionId, participantId: participant.id, generation: 1,
                startedAt: new Date('2026-09-21T17:45:00Z'), lastHeartbeatAt: new Date('2026-09-21T17:46:00Z'),
                endedAt: new Date('2026-09-21T17:46:00Z'),
            },
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.webSession.deleteMany({ where: { accountIssuer: issuer, accountSubject: { in: Object.values(subjects) } } });
        await prisma.scheduledSession.deleteMany({ where: { id: { in: [publicSessionId, privateSessionId] } } });
        await prisma.user.deleteMany({ where: { id: facilitatorId } });
        await prisma.$disconnect();
        await pool.end();
    });

    it('dry-runs, updates only one unambiguous target, and replays as a no-op', async () => {
        await expect(backfillAccountAttendanceEmail(prisma, { accountIssuer: issuer })).resolves.toMatchObject({
            mode: 'dry-run', outcome: 'would-update', updatedCount: 0,
            before: {
                targetCount: 4, wouldUpdateCount: 1, noVerifiedSourceCount: 1,
                ambiguousSourceCount: 1, overLimitSourceCount: 1, affectedFeedEntryCount: 1,
            },
        });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.unique } })).accountEmail)
            .toBeNull();

        await expect(backfillAccountAttendanceEmail(prisma, { apply: true, accountIssuer: issuer })).resolves.toMatchObject({
            mode: 'apply', outcome: 'updated', updatedCount: 1,
            after: { targetCount: 3, wouldUpdateCount: 0 },
        });
        expect((await prisma.ticketEntitlement.findUniqueOrThrow({ where: { id: ticketIds.unique } })))
            .toMatchObject({ accountEmail: 'unique@example.test', accountEmailVerified: true });
        for (const key of ['ambiguous', 'unverified', 'overLimit', 'private'] as const) {
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
