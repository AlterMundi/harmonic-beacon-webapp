import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest } from '@/__tests__/helpers';
import { prisma } from '@/lib/db';
import { digestSessionToken } from '@/lib/session-auth';

vi.mock('@/lib/livekit-server', () => ({
    stableRoomIdentity: (eventId: string, kind: string, principalId: string) =>
        `race:${eventId}:${kind}:${principalId}`,
}));

const integration = process.env.ROOM_ENTITLEMENT_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const NOW = new Date('2026-08-05T12:00:00.000Z');
const SESSION_ID = '91000000-0000-4000-8000-000000000156';
const FACILITATOR_ID = '92000000-0000-4000-8000-000000000156';
const TICKET_ID = '93000000-0000-4000-8000-000000000156';
const TICKET_COOKIE = 'room-entitlement-race-ticket';
const STAFF_COOKIE = 'room-entitlement-race-staff';

function request(cookie: string) {
    return createRequest(`/api/scheduled-sessions/${SESSION_ID}/token`, {
        headers: { cookie: `hb_session=${cookie}` },
    });
}

integration('room entitlement PostgreSQL concurrency', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('room entitlement integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'room entitlement integration writes are restricted to the exact configured *_test database',
            );
        }

        await prisma.webSession.deleteMany({
            where: { tokenDigest: { in: [
                digestSessionToken(TICKET_COOKIE),
                digestSessionToken(STAFF_COOKIE),
            ] } },
        });
        await prisma.sessionParticipant.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.ticketEntitlement.deleteMany({ where: { id: TICKET_ID } });
        await prisma.scheduledSession.deleteMany({ where: { id: SESSION_ID } });
        await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });

        await prisma.user.create({
            data: {
                id: FACILITATOR_ID,
                email: 'room-race-facilitator@integration.invalid',
                name: 'Race facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: SESSION_ID,
                title: 'Room entitlement race integration',
                roomName: 'room-entitlement-race-integration',
                language: 'SPANISH',
                scheduledAt: NOW,
                status: 'LIVE',
                paidMode: true,
                attendeeCap: 150,
                facilitatorId: FACILITATOR_ID,
            },
        });
        await prisma.ticketEntitlement.create({
            data: {
                id: TICKET_ID,
                scheduledSessionId: SESSION_ID,
                codeDigest: 'a'.repeat(64),
                codeLastFour: 'R156',
                tier: 'GLOBAL_SOUTH',
                state: 'BOUND',
                boundEmail: 'room-race-attendee@integration.invalid',
                boundAt: NOW,
                expiresAt: new Date('2026-08-06T12:00:00.000Z'),
            },
        });
        await prisma.webSession.createMany({
            data: [
                {
                    tokenDigest: digestSessionToken(TICKET_COOKIE),
                    displayName: 'Race attendee',
                    displayNameConfirmedAt: NOW,
                    ticketEntitlementId: TICKET_ID,
                    expiresAt: new Date('2026-08-06T12:00:00.000Z'),
                },
                {
                    tokenDigest: digestSessionToken(STAFF_COOKIE),
                    displayName: 'Race facilitator',
                    staffUserId: FACILITATOR_ID,
                    expiresAt: new Date('2026-08-06T12:00:00.000Z'),
                },
            ],
        });
        // Force PostgreSQL's non-arbiter principal-link constraint to win for
        // every contender after the first. Production exposed the same P2002
        // when Stage and Beacon materialized one fresh principal together:
        // the upsert arbitrates `(session, identity)`, while the independent
        // `(session, ticket|staff)` partial index can still reject the insert.
        // The first insert keeps the canonical identity; delayed contenders
        // get a trigger-only identity so they collide solely on the principal
        // link. Application code must then re-read the canonical winner.
        await prisma.$executeRawUnsafe(
            'CREATE SEQUENCE room_entitlement_race_sequence START 1',
        );
        await prisma.$executeRawUnsafe(`
            CREATE OR REPLACE FUNCTION room_entitlement_race_delay()
            RETURNS trigger AS $$
            DECLARE
                contender bigint;
            BEGIN
                IF NEW.scheduled_session_id = '${SESSION_ID}'::uuid THEN
                    contender := nextval('room_entitlement_race_sequence');
                    IF contender > 1 THEN
                        PERFORM pg_sleep(0.05);
                        NEW.participant_identity := NEW.participant_identity || '-contender-' || contender;
                    END IF;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
            CREATE TRIGGER room_entitlement_race_delay_trigger
            BEFORE INSERT ON session_participants
            FOR EACH ROW EXECUTE FUNCTION room_entitlement_race_delay()
        `);
    });

    beforeEach(async () => {
        await prisma.sessionParticipant.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.$executeRawUnsafe(
            'ALTER SEQUENCE room_entitlement_race_sequence RESTART WITH 1',
        );
    });

    afterAll(async () => {
        await prisma.$executeRawUnsafe(
            'DROP TRIGGER IF EXISTS room_entitlement_race_delay_trigger ON session_participants',
        );
        await prisma.$executeRawUnsafe(
            'DROP FUNCTION IF EXISTS room_entitlement_race_delay()',
        );
        await prisma.$executeRawUnsafe(
            'DROP SEQUENCE IF EXISTS room_entitlement_race_sequence',
        );
        await prisma.webSession.deleteMany({
            where: { tokenDigest: { in: [
                digestSessionToken(TICKET_COOKIE),
                digestSessionToken(STAFF_COOKIE),
            ] } },
        });
        await prisma.sessionParticipant.deleteMany({ where: { scheduledSessionId: SESSION_ID } });
        await prisma.ticketEntitlement.deleteMany({ where: { id: TICKET_ID } });
        await prisma.scheduledSession.deleteMany({ where: { id: SESSION_ID } });
        await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
        await prisma.$disconnect();
    });

    it.each([
        ['ticket', TICKET_COOKIE, TICKET_ID, null],
        ['staff', STAFF_COOKIE, null, FACILITATOR_ID],
    ] as const)(
        'converges concurrent fresh %s joins onto one canonical participant',
        async (_kind, cookie, ticketEntitlementId, staffUserId) => {
            const { resolveRoomPrincipal } = await import('../room-entitlement');
            const results = await Promise.all(
                Array.from({ length: 24 }, () =>
                    resolveRoomPrincipal(request(cookie), SESSION_ID, NOW)),
            );

            expect(results.every((result) => result.ok)).toBe(true);
            const successful = results.filter((result) => result.ok);
            expect(new Set(successful.map((result) => result.principal.identity)).size).toBe(1);

            const participants = await prisma.sessionParticipant.findMany({
                where: { scheduledSessionId: SESSION_ID },
            });
            expect(participants).toHaveLength(1);
            expect(participants[0]).toMatchObject({
                participantIdentity: successful[0].principal.identity,
                ticketEntitlementId,
                staffUserId,
                leftAt: null,
            });
        },
    );
});
