import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    decodeAmplificationCreditCursor,
    listAmplificationCreditEntries,
} from '@/lib/amplification-credit-feed';
import { prisma } from '@/lib/db';

const integration = process.env.AMPLIFICATION_CREDIT_FEED_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const FACILITATOR_ID = 'a0000000-0000-4000-8000-000000000001';
const PAID_SESSION_ID = 'a1000000-0000-4000-8000-000000000001';
const FREE_SESSION_ID = 'a2000000-0000-4000-8000-000000000001';
const TEST_SESSION_ID = 'a3000000-0000-4000-8000-000000000001';
const SESSION_IDS = [PAID_SESSION_ID, FREE_SESSION_ID, TEST_SESSION_ID];

const PAID_TICKET_ID = 'b1000000-0000-4000-8000-000000000001';
const FREE_TICKET_ID = 'b2000000-0000-4000-8000-000000000001';
const TEST_TICKET_ID = 'b3000000-0000-4000-8000-000000000001';
const NO_PRESENCE_TICKET_ID = 'b1000000-0000-4000-8000-000000000003';

const PAID_PARTICIPANT_ID = 'c1000000-0000-4000-8000-000000000001';
const FREE_PARTICIPANT_ID = 'c2000000-0000-4000-8000-000000000001';
const STAFF_PARTICIPANT_ID = 'c1000000-0000-4000-8000-000000000002';
const TEST_PARTICIPANT_ID = 'c3000000-0000-4000-8000-000000000001';
const NO_PRESENCE_PARTICIPANT_ID = 'c1000000-0000-4000-8000-000000000004';
const REGISTRATION_ID = 'd1000000-0000-4000-8000-000000000001';

async function cleanup(): Promise<void> {
    await prisma.commerceEntitlement.deleteMany({ where: { scheduledSessionId: { in: SESSION_IDS } } });
    await prisma.scheduledSession.deleteMany({ where: { id: { in: SESSION_IDS } } });
    await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
}

integration('amplification credit feed PostgreSQL eligibility contract', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('amplification credit integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'amplification credit integration cleanup is restricted to the exact configured *_test database',
            );
        }

        await cleanup();
        await prisma.user.create({
            data: {
                id: FACILITATOR_ID,
                email: 'amplification-feed@integration.invalid',
                name: 'Integration facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.createMany({
            data: [
                {
                    id: PAID_SESSION_ID,
                    title: 'Paid eligible session',
                    roomName: 'amplification-feed-paid',
                    language: 'SPANISH',
                    scheduledAt: new Date('2026-08-09T19:00:00.000Z'),
                    status: 'ENDED',
                    paidMode: true,
                    facilitatorId: FACILITATOR_ID,
                },
                {
                    id: FREE_SESSION_ID,
                    title: 'Free eligible session',
                    roomName: 'amplification-feed-free',
                    language: 'ENGLISH',
                    scheduledAt: new Date('2026-08-09T19:30:00.000Z'),
                    status: 'ENDED',
                    paidMode: true,
                    publicAccess: true,
                    facilitatorId: FACILITATOR_ID,
                },
                {
                    id: TEST_SESSION_ID,
                    title: 'Excluded test session',
                    roomName: 'amplification-feed-test',
                    language: 'SPANISH',
                    scheduledAt: new Date('2026-08-09T20:00:00.000Z'),
                    status: 'ENDED',
                    isTest: true,
                    facilitatorId: FACILITATOR_ID,
                },
            ],
        });
        const expiresAt = new Date('2026-08-10T19:00:00.000Z');
        await prisma.ticketEntitlement.createMany({
            data: [
                { id: PAID_TICKET_ID, scheduledSessionId: PAID_SESSION_ID, codeDigest: 'feed-paid', codeLastFour: 'PAID', tier: 'GLOBAL_NORTH', state: 'BOUND', boundEmail: 'paid@example.com', boundAt: new Date('2026-08-09T19:00:00.000Z'), expiresAt },
                { id: FREE_TICKET_ID, scheduledSessionId: FREE_SESSION_ID, codeDigest: 'feed-free', codeLastFour: 'FREE', tier: 'COMP', state: 'BOUND', boundEmail: null, accountId: 'synthetic-free-account', accountIssuer: 'https://accounts.integration.invalid', boundAt: new Date('2026-08-09T19:00:00.000Z'), expiresAt },
                { id: TEST_TICKET_ID, scheduledSessionId: TEST_SESSION_ID, codeDigest: 'feed-test', codeLastFour: 'TEST', tier: 'COMP', state: 'BOUND', boundEmail: 'test@example.com', boundAt: new Date('2026-08-09T19:00:00.000Z'), expiresAt },
                { id: NO_PRESENCE_TICKET_ID, scheduledSessionId: PAID_SESSION_ID, codeDigest: 'feed-none', codeLastFour: 'NONE', tier: 'GLOBAL_SOUTH', state: 'BOUND', boundEmail: 'absent@example.com', boundAt: new Date('2026-08-09T19:00:00.000Z'), expiresAt },
            ],
        });
        await prisma.sessionParticipant.createMany({
            data: [
                { id: PAID_PARTICIPANT_ID, scheduledSessionId: PAID_SESSION_ID, participantIdentity: 'paid-person', displayName: 'Paid person', ticketEntitlementId: PAID_TICKET_ID },
                { id: FREE_PARTICIPANT_ID, scheduledSessionId: FREE_SESSION_ID, participantIdentity: 'free-person', displayName: null, ticketEntitlementId: FREE_TICKET_ID },
                { id: STAFF_PARTICIPANT_ID, scheduledSessionId: PAID_SESSION_ID, participantIdentity: 'staff-person', displayName: 'Staff person', staffUserId: FACILITATOR_ID },
                { id: TEST_PARTICIPANT_ID, scheduledSessionId: TEST_SESSION_ID, participantIdentity: 'test-person', displayName: 'Test person', ticketEntitlementId: TEST_TICKET_ID },
                { id: NO_PRESENCE_PARTICIPANT_ID, scheduledSessionId: PAID_SESSION_ID, participantIdentity: 'absent-person', displayName: 'Absent person', ticketEntitlementId: NO_PRESENCE_TICKET_ID },
            ],
        });
        await prisma.livePresenceInterval.createMany({
            data: [
                { scheduledSessionId: PAID_SESSION_ID, participantId: PAID_PARTICIPANT_ID, generation: 1, startedAt: new Date('2026-08-09T20:00:00.000Z'), lastHeartbeatAt: new Date('2026-08-09T20:01:00.000Z'), endedAt: new Date('2026-08-09T20:01:00.000Z') },
                { scheduledSessionId: PAID_SESSION_ID, participantId: PAID_PARTICIPANT_ID, generation: 2, startedAt: new Date('2026-08-09T20:05:00.000Z'), lastHeartbeatAt: new Date('2026-08-09T20:06:00.000Z'), endedAt: new Date('2026-08-09T20:06:00.000Z'), reconnectCount: 1 },
                { scheduledSessionId: FREE_SESSION_ID, participantId: FREE_PARTICIPANT_ID, generation: 1, startedAt: new Date('2026-08-09T20:15:30.000Z'), lastHeartbeatAt: new Date('2026-08-09T20:16:00.000Z'), endedAt: new Date('2026-08-09T20:16:00.000Z') },
                { scheduledSessionId: PAID_SESSION_ID, participantId: STAFF_PARTICIPANT_ID, generation: 1, startedAt: new Date('2026-08-09T19:50:00.000Z'), lastHeartbeatAt: new Date('2026-08-09T19:51:00.000Z'), endedAt: new Date('2026-08-09T19:51:00.000Z') },
                { scheduledSessionId: TEST_SESSION_ID, participantId: TEST_PARTICIPANT_ID, generation: 1, startedAt: new Date('2026-08-09T19:45:00.000Z'), lastHeartbeatAt: new Date('2026-08-09T19:46:00.000Z'), endedAt: new Date('2026-08-09T19:46:00.000Z') },
            ],
        });
        await prisma.commerceEntitlement.create({
            data: {
                provider: 'TICKET_TAILOR',
                externalTicketId: 'amplification-feed-paid-ticket',
                externalOrderId: 'amplification-feed-paid-order',
                registrationId: REGISTRATION_ID,
                scheduledSessionId: PAID_SESSION_ID,
                ticketEntitlementId: PAID_TICKET_ID,
                providerState: 'ACTIVE',
                reasonCode: 'PAYMENT_VERIFIED',
                provisionRevision: 1,
                commandHash: 'a'.repeat(64),
                boundEmail: 'paid@example.com',
                tier: 'GLOBAL_NORTH',
                grantId: 'e1000000-0000-4000-8000-000000000001',
                grantGeneration: 1,
                derivationKeyVersion: 1,
                codeDigestVersion: 1,
                providerObservedAt: new Date('2026-08-09T19:00:00.000Z'),
            },
        });
    });

    afterAll(async () => {
        await cleanup();
        await prisma.$disconnect();
    });

    it('filters ineligible rows, includes paid/free, deduplicates reconnects and paginates durably', async () => {
        const first = await listAmplificationCreditEntries({ cursor: null, limit: 1 });
        expect(first.entries).toEqual([{
            entry_id: PAID_PARTICIPANT_ID,
            scheduled_session_id: PAID_SESSION_ID,
            ticket_entitlement_id: PAID_TICKET_ID,
            registration_id: REGISTRATION_ID,
            email: 'paid@example.com',
            display_name: 'Paid person',
            entered_at: '2026-08-09T20:00:00.000Z',
        }]);

        const second = await listAmplificationCreditEntries({
            cursor: decodeAmplificationCreditCursor(first.next_cursor),
            limit: 1,
        });
        expect(second.entries).toEqual([{
            entry_id: FREE_PARTICIPANT_ID,
            scheduled_session_id: FREE_SESSION_ID,
            ticket_entitlement_id: FREE_TICKET_ID,
            registration_id: null,
            email: null,
            display_name: null,
            entered_at: '2026-08-09T20:15:30.000Z',
        }]);

        const cursor = decodeAmplificationCreditCursor(second.next_cursor);
        const empty = await listAmplificationCreditEntries({ cursor, limit: 100 });
        expect(empty.entries).toEqual([]);
        expect(empty.next_cursor).toBe(second.next_cursor);
    });
});
