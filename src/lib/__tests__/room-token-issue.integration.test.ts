import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import type { RoomPrincipal } from '@/lib/room-entitlement';
import { digestSessionToken } from '@/lib/session-auth';

const integration = process.env.ROOM_TOKEN_ISSUE_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const NOW = new Date('2026-08-05T12:00:00.000Z');
const SESSION_ID = '91000000-0000-4000-8000-000000000157';
const FACILITATOR_ID = '92000000-0000-4000-8000-000000000157';
const TICKET_ID = '93000000-0000-4000-8000-000000000157';
const TICKET_COOKIE = 'room-token-race-ticket';
const STAFF_COOKIE = 'room-token-race-staff';
const TICKET_IDENTITY = 'room-token-race-ticket-identity';
const STAFF_IDENTITY = 'room-token-race-staff-identity';

const session = {
    id: SESSION_ID,
    title: 'Room token concurrency integration',
    roomName: 'room-token-race-integration',
    status: 'LIVE' as const,
    startedAt: NOW,
};

const ticketPrincipal: RoomPrincipal = {
    session,
    identity: TICKET_IDENTITY,
    displayName: 'Race attendee',
    role: 'ATTENDEE',
    isAssignedFacilitator: false,
    canPublish: false,
    ticketEntitlementId: TICKET_ID,
    staffUserId: null,
};

const staffPrincipal: RoomPrincipal = {
    session,
    identity: STAFF_IDENTITY,
    displayName: 'Race facilitator',
    role: 'FACILITATOR',
    isAssignedFacilitator: true,
    canPublish: true,
    ticketEntitlementId: null,
    staffUserId: FACILITATOR_ID,
};

integration('room token finalization PostgreSQL concurrency', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('room token integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'room token integration writes are restricted to the exact configured *_test database',
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
                email: 'room-token-race-facilitator@integration.invalid',
                name: 'Race facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: SESSION_ID,
                title: session.title,
                roomName: session.roomName,
                language: 'SPANISH',
                scheduledAt: NOW,
                startedAt: NOW,
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
                codeDigest: 'b'.repeat(64),
                codeLastFour: 'R157',
                tier: 'GLOBAL_SOUTH',
                state: 'BOUND',
                boundEmail: 'room-token-race-attendee@integration.invalid',
                boundAt: NOW,
                expiresAt: new Date('2026-08-06T12:00:00.000Z'),
            },
        });
        await prisma.webSession.createMany({
            data: [
                {
                    tokenDigest: digestSessionToken(TICKET_COOKIE),
                    displayName: ticketPrincipal.displayName,
                    ticketEntitlementId: TICKET_ID,
                    expiresAt: new Date('2026-08-06T12:00:00.000Z'),
                },
                {
                    tokenDigest: digestSessionToken(STAFF_COOKIE),
                    displayName: staffPrincipal.displayName,
                    staffUserId: FACILITATOR_ID,
                    expiresAt: new Date('2026-08-06T12:00:00.000Z'),
                },
            ],
        });
        await prisma.sessionParticipant.createMany({
            data: [
                {
                    scheduledSessionId: SESSION_ID,
                    participantIdentity: TICKET_IDENTITY,
                    displayName: ticketPrincipal.displayName,
                    ticketEntitlementId: TICKET_ID,
                },
                {
                    scheduledSessionId: SESSION_ID,
                    participantIdentity: STAFF_IDENTITY,
                    displayName: staffPrincipal.displayName,
                    staffUserId: FACILITATOR_ID,
                    publishGrantedAt: NOW,
                    grantVersion: 1,
                    grantReason: 'Facilitator preflight grant',
                },
            ],
        });
    });

    beforeEach(async () => {
        await prisma.sessionParticipant.updateMany({
            where: { scheduledSessionId: SESSION_ID },
            data: { maxLivekitTokenExpiresAt: null },
        });
    });

    afterAll(async () => {
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
        ['ticket', TICKET_COOKIE, ticketPrincipal],
        ['staff', STAFF_COOKIE, staffPrincipal],
    ] as const)(
        'serializes a same-event burst of %s token horizons without rejecting valid issuers',
        async (_kind, cookieValue, principal) => {
            const { finalizeRoomTokenIssue } = await import('../room-token-issue');
            const expirations = Array.from(
                { length: 24 },
                (_unused, index) => new Date(NOW.getTime() + (300 + index) * 1000),
            );

            const results = await Promise.all(expirations.map((tokenExpiresAt) =>
                finalizeRoomTokenIssue({
                    cookieValue,
                    principal,
                    expectedIdentity: principal.identity,
                    expectedCanPublish: principal.canPublish,
                    tokenExpiresAt,
                    now: NOW,
                }),
            ));

            expect(results).toEqual(Array.from({ length: 24 }, () => true));
            const participant = await prisma.sessionParticipant.findFirstOrThrow({
                where: {
                    scheduledSessionId: SESSION_ID,
                    participantIdentity: principal.identity,
                },
                select: { maxLivekitTokenExpiresAt: true },
            });
            expect(participant.maxLivekitTokenExpiresAt).toEqual(expirations.at(-1));
        },
    );
});
