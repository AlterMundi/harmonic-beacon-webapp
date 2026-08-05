import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contributionSubmissionLimiter } from '@/lib/contribution-rate-limit';
import { prisma } from '@/lib/db';
import {
    ContributionError,
    createContribution,
    listPublicContributions,
} from '@/lib/session-contributions';

/**
 * CHAT-01 (#137) integration: the idempotency and ordering guarantees that
 * only a real PostgreSQL unique index can prove. Gated exactly like the room
 * entitlement race suite: CONTRIBUTIONS_INTEGRATION_TEST=1 plus a *_test
 * database, enforced by an explicit guard before any write.
 */

const integration = process.env.CONTRIBUTIONS_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const SESSION_ID = '91000000-0000-4000-8000-000000000157';
const FACILITATOR_ID = '92000000-0000-4000-8000-000000000157';
const TICKET_A_ID = '93000000-0000-4000-8000-000000000157';
const TICKET_B_ID = '94000000-0000-4000-8000-000000000157';
const PARTICIPANT_A_ID = '95000000-0000-4000-8000-000000000157';
const PARTICIPANT_B_ID = '96000000-0000-4000-8000-000000000157';

const base = {
    scheduledSessionId: SESSION_ID,
    displayName: 'Ana',
    body: '¿Cómo respiramos juntas? Siento calma 🪷',
    visibility: 'NAMED',
};

integration('session contributions PostgreSQL guarantees', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('contributions integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'contributions integration writes are restricted to the exact configured *_test database',
            );
        }

        await prisma.user.upsert({
            where: { id: FACILITATOR_ID },
            create: {
                id: FACILITATOR_ID,
                email: 'contributions-facilitator@example.test',
                name: 'Facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'scrypt:dGVzdC1zYWx0LXNpeHRlZW4:dGVzdA',
            },
            update: {},
        });
        await prisma.scheduledSession.upsert({
            where: { id: SESSION_ID },
            create: {
                id: SESSION_ID,
                title: 'Contributions integration',
                roomName: 'contributions-integration-room',
                language: 'SPANISH',
                scheduledAt: new Date('2026-08-08T20:00:00Z'),
                startedAt: new Date('2026-08-08T20:00:00Z'),
                status: 'LIVE',
                facilitatorId: FACILITATOR_ID,
            },
            update: {},
        });
        for (const [ticketId, participantId, identity] of [
            [TICKET_A_ID, PARTICIPANT_A_ID, 'lk-ticket-a'],
            [TICKET_B_ID, PARTICIPANT_B_ID, 'lk-ticket-b'],
        ] as const) {
            await prisma.ticketEntitlement.upsert({
                where: { id: ticketId },
                create: {
                    id: ticketId,
                    scheduledSessionId: SESSION_ID,
                    codeDigest: `digest-${identity}`,
                    codeLastFour: '0000',
                    tier: 'GLOBAL_SOUTH',
                    state: 'BOUND',
                    boundEmail: `${identity}@example.test`,
                    expiresAt: new Date('2027-01-01T00:00:00Z'),
                },
                update: {},
            });
            await prisma.sessionParticipant.upsert({
                where: { id: participantId },
                create: {
                    id: participantId,
                    scheduledSessionId: SESSION_ID,
                    participantIdentity: identity,
                    ticketEntitlementId: ticketId,
                },
                update: {},
            });
        }
    });

    afterAll(async () => {
        await prisma.sessionContribution.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.sessionParticipant.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.ticketEntitlement.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.scheduledSession.deleteMany({ where: { id: SESSION_ID } });
        await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
        contributionSubmissionLimiter.reset();
    });

    it('concurrent first submissions with one key persist exactly one row', async () => {
        contributionSubmissionLimiter.reset();
        const attempts = await Promise.allSettled([
            createContribution({ ...base, ticketEntitlementId: TICKET_A_ID, idempotencyKey: 'race-1' }),
            createContribution({ ...base, ticketEntitlementId: TICKET_A_ID, idempotencyKey: 'race-1' }),
            createContribution({ ...base, ticketEntitlementId: TICKET_A_ID, idempotencyKey: 'race-1' }),
        ]);

        const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
        expect(fulfilled.length).toBe(3);
        const ids = new Set(fulfilled.map((a) => a.value.contribution.id));
        expect(ids.size).toBe(1);
        expect(fulfilled.filter((a) => a.value.created).length).toBe(1);

        const stored = await prisma.sessionContribution.count({
            where: { scheduledSessionId: SESSION_ID, idempotencyKey: 'race-1' },
        });
        expect(stored).toBe(1);
    });

    it('a key reused with a different payload is rejected with 409', async () => {
        contributionSubmissionLimiter.reset();
        await expect(createContribution({
            ...base,
            ticketEntitlementId: TICKET_A_ID,
            idempotencyKey: 'race-1',
            body: 'un mensaje distinto',
        })).rejects.toMatchObject({
            code: 'idempotency_key_conflict',
            status: 409,
        });
        await expect(createContribution({
            ...base,
            ticketEntitlementId: TICKET_A_ID,
            idempotencyKey: 'race-1',
            visibility: 'ANONYMOUS',
        })).rejects.toMatchObject({ status: 409 });
    });

    it('the public feed is stable-ordered and anonymous-safe across participants', async () => {
        contributionSubmissionLimiter.reset();
        await createContribution({
            ...base,
            ticketEntitlementId: TICKET_B_ID,
            displayName: 'Beto',
            idempotencyKey: 'feed-1',
            body: 'primera pregunta, siento vértigo',
            visibility: 'ANONYMOUS',
        });

        const page = await listPublicContributions({
            scheduledSessionId: SESSION_ID,
            cursor: null,
            limit: 50,
        });
        expect(page.contributions.length).toBe(2);
        const [first, second] = page.contributions;
        expect(first.createdAt <= second.createdAt).toBe(true);
        const anonymous = page.contributions.find((c) => c.visibility === 'ANONYMOUS');
        expect(anonymous?.displayName).toBeNull();
        expect(JSON.stringify(page)).not.toContain('Beto');
        expect(JSON.stringify(page)).not.toContain(PARTICIPANT_A_ID);
    });

    it('a contribution to a session the ticket does not name cannot exist', async () => {
        // createContribution only writes under (session, ticket) resolved
        // server-side; a mismatched pair finds no participant and rejects.
        contributionSubmissionLimiter.reset();
        await expect(createContribution({
            ...base,
            scheduledSessionId: '00000000-0000-4000-8000-000000000999',
            ticketEntitlementId: TICKET_A_ID,
            idempotencyKey: 'cross-1',
        })).rejects.toSatisfy(
            (error) => error instanceof ContributionError && error.code === 'participant_not_joined',
        );
    });
});
