import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contributionSubmissionLimiter } from '@/lib/contribution-rate-limit';
import { prisma } from '@/lib/db';
import {
    ContributionError,
    createContribution,
    decodeContributionCursor,
    listPublicContributions,
    listStaffContributions,
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
// Second session: pagination, cursor isolation and same-timestamp ordering.
const SESSION2_ID = '91000000-0000-4000-8000-000000000158';
const TICKET_C_ID = '93000000-0000-4000-8000-000000000158';
const PARTICIPANT_C_ID = '95000000-0000-4000-8000-000000000158';

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
                    boundAt: new Date('2026-08-08T19:00:00Z'),
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
        await prisma.scheduledSession.upsert({
            where: { id: SESSION2_ID },
            create: {
                id: SESSION2_ID,
                title: 'Contributions integration — pagination',
                roomName: 'contributions-integration-room-2',
                language: 'SPANISH',
                scheduledAt: new Date('2026-08-08T21:00:00Z'),
                startedAt: new Date('2026-08-08T21:00:00Z'),
                status: 'LIVE',
                facilitatorId: FACILITATOR_ID,
            },
            update: {},
        });
        await prisma.ticketEntitlement.upsert({
            where: { id: TICKET_C_ID },
            create: {
                id: TICKET_C_ID,
                scheduledSessionId: SESSION2_ID,
                codeDigest: 'digest-lk-ticket-c',
                codeLastFour: '0000',
                tier: 'GLOBAL_SOUTH',
                state: 'BOUND',
                boundEmail: 'lk-ticket-c@example.test',
                boundAt: new Date('2026-08-08T20:00:00Z'),
                expiresAt: new Date('2027-01-01T00:00:00Z'),
            },
            update: {},
        });
        await prisma.sessionParticipant.upsert({
            where: { id: PARTICIPANT_C_ID },
            create: {
                id: PARTICIPANT_C_ID,
                scheduledSessionId: SESSION2_ID,
                participantIdentity: 'lk-ticket-c',
                ticketEntitlementId: TICKET_C_ID,
            },
            update: {},
        });
    });

    afterAll(async () => {
        await prisma.sessionContribution.deleteMany({
            where: { scheduledSessionId: { in: [SESSION_ID, SESSION2_ID] } },
        });
        await prisma.sessionParticipant.deleteMany({
            where: { scheduledSessionId: { in: [SESSION_ID, SESSION2_ID] } },
        });
        await prisma.ticketEntitlement.deleteMany({
            where: { scheduledSessionId: { in: [SESSION_ID, SESSION2_ID] } },
        });
        await prisma.scheduledSession.deleteMany({ where: { id: { in: [SESSION_ID, SESSION2_ID] } } });
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

    it('a replay survives budget exhaustion; a sixth new key gets 429', async () => {
        contributionSubmissionLimiter.reset();
        for (let i = 0; i < 5; i += 1) {
            const result = await createContribution({
                ...base,
                ticketEntitlementId: TICKET_B_ID,
                idempotencyKey: `ex-${i}`,
                body: `mensaje de presupuesto ${i}`,
            });
            expect(result.created).toBe(true);
        }

        // Replay of the fifth: canonical, not a 429.
        const replay = await createContribution({
            ...base,
            ticketEntitlementId: TICKET_B_ID,
            idempotencyKey: 'ex-4',
            body: 'mensaje de presupuesto 4',
        });
        expect(replay.created).toBe(false);

        // Same key, different payload: 409.
        await expect(createContribution({
            ...base,
            ticketEntitlementId: TICKET_B_ID,
            idempotencyKey: 'ex-4',
            body: 'otro contenido',
        })).rejects.toMatchObject({ code: 'idempotency_key_conflict', status: 409 });

        // Sixth new key: 429.
        await expect(createContribution({
            ...base,
            ticketEntitlementId: TICKET_B_ID,
            idempotencyKey: 'ex-5',
            body: 'mensaje de presupuesto 5',
        })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });

        const stored = await prisma.sessionContribution.count({
            where: { scheduledSessionId: SESSION_ID, idempotencyKey: { startsWith: 'ex-' } },
        });
        expect(stored).toBe(5);
    });

    it('six concurrent new keys for one participant persist exactly five', async () => {
        contributionSubmissionLimiter.reset();
        const attempts = await Promise.allSettled(
            Array.from({ length: 6 }, (_, i) =>
                createContribution({
                    ...base,
                    ticketEntitlementId: TICKET_A_ID,
                    idempotencyKey: `burst-${i}`,
                    body: `mensaje concurrente ${i}`,
                })),
        );

        const created = attempts.filter((a) => a.status === 'fulfilled' && a.value.created);
        const limited = attempts.filter(
            (a) => a.status === 'rejected'
                && (a.reason as ContributionError).code === 'rate_limited',
        );
        expect(created.length).toBe(5);
        expect(limited.length).toBe(1);

        const stored = await prisma.sessionContribution.count({
            where: { scheduledSessionId: SESSION_ID, idempotencyKey: { startsWith: 'burst-' } },
        });
        expect(stored).toBe(5);
    });

    it('paginates multiple pages without skips or duplicates', async () => {
        // Five rows with deterministic timestamps, written directly: the
        // pagination contract is a read-side guarantee.
        for (let i = 0; i < 5; i += 1) {
            await prisma.sessionContribution.create({
                data: {
                    scheduledSessionId: SESSION2_ID,
                    authorParticipantId: PARTICIPANT_C_ID,
                    authorDisplayName: 'Cora',
                    body: `mensaje paginado ${i}`,
                    visibility: 'NAMED',
                    idempotencyKey: `page-${i}`,
                    requestDigest: `digest-page-${i}`.padEnd(64, '0'),
                    createdAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000),
                },
            });
        }

        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
            const page = await listPublicContributions({
                scheduledSessionId: SESSION2_ID,
                cursor: cursor ? decodeContributionCursor(cursor) : null,
                limit: 2,
            });
            seen.push(...page.contributions.map((c) => c.body));
            cursor = page.hasMore ? page.nextPageCursor : null;
            pages += 1;
            expect(pages).toBeLessThanOrEqual(4); // no infinite loop
        } while (cursor !== null);

        expect(seen).toEqual([
            'mensaje paginado 0', 'mensaje paginado 1',
            'mensaje paginado 2', 'mensaje paginado 3',
            'mensaje paginado 4',
        ]);
        expect(pages).toBe(3);
    });

    it('orders two rows with the same createdAt by id', async () => {
        const sameInstant = new Date('2026-01-01T00:05:00.000Z');
        const firstId = '97000000-0000-4000-8000-000000000001';
        const secondId = '97000000-0000-4000-8000-000000000002';
        // Insert in reverse id order: only the (createdAt, id) key may decide.
        for (const [id, key] of [[secondId, 'tie-2'], [firstId, 'tie-1']] as const) {
            await prisma.sessionContribution.create({
                data: {
                    id,
                    scheduledSessionId: SESSION2_ID,
                    authorParticipantId: PARTICIPANT_C_ID,
                    authorDisplayName: 'Cora',
                    body: `empate ${key}`,
                    visibility: 'NAMED',
                    idempotencyKey: key,
                    requestDigest: `digest-${key}`.padEnd(64, '0'),
                    createdAt: sameInstant,
                },
            });
        }

        const page = await listPublicContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: { createdAt: '2026-01-01T00:04:59.000Z', id: '00000000-0000-0000-0000-000000000000' },
            limit: 50,
        });
        const tied = page.contributions.filter((c) => c.body.startsWith('empate'));
        expect(tied.map((c) => c.id)).toEqual([firstId, secondId]);
    });

    it('a tail resumeCursor polls exactly the rows created after it, in both feeds', async () => {
        // Read the tail of session 2: every row so far, then keep the cursor.
        const tail = await listPublicContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: null,
            limit: 50,
        });
        expect(tail.hasMore).toBe(false);
        expect(tail.nextPageCursor).toBeNull();
        expect(tail.resumeCursor).not.toBeNull();
        const resume = decodeContributionCursor(tail.resumeCursor);

        // A poll right now finds nothing: empty page, both cursors null.
        const empty = await listPublicContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: resume,
            limit: 50,
        });
        expect(empty.contributions).toEqual([]);
        expect(empty.hasMore).toBe(false);
        expect(empty.resumeCursor).toBeNull();

        // A new contribution appears; the same cursor surfaces exactly it.
        contributionSubmissionLimiter.reset();
        await createContribution({
            ...base,
            scheduledSessionId: SESSION2_ID,
            ticketEntitlementId: TICKET_C_ID,
            displayName: 'Cora',
            idempotencyKey: 'tail-1',
            body: 'mensaje después del tail',
        });

        const publicPoll = await listPublicContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: resume,
            limit: 50,
        });
        expect(publicPoll.contributions.map((c) => c.body)).toEqual(['mensaje después del tail']);
        expect(publicPoll.resumeCursor).not.toBeNull();

        const staffPoll = await listStaffContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: resume,
            limit: 50,
        });
        expect(staffPoll.contributions.map((c) => c.body)).toEqual(['mensaje después del tail']);
        expect(staffPoll.contributions[0].authorDisplayName).toBe('Cora');
    });

    it('a cursor minted in one session never unlocks another session feed', async () => {
        const foreign = await listPublicContributions({
            scheduledSessionId: SESSION_ID,
            cursor: null,
            limit: 50,
        });
        expect(foreign.resumeCursor).not.toBeNull();

        const otherFeed = await listPublicContributions({
            scheduledSessionId: SESSION2_ID,
            cursor: decodeContributionCursor(foreign.resumeCursor),
            limit: 50,
        });
        // Anything returned belongs to session 2 only; session 1 ids are absent.
        const session1Ids = new Set(foreign.contributions.map((c) => c.id));
        for (const contribution of otherFeed.contributions) {
            expect(session1Ids.has(contribution.id)).toBe(false);
        }
    });
});
