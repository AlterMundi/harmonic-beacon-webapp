import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({
    rooms: new Map<string, Set<string>>(),
    fail: false,
}));

vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: (identity: string) => `bed-${identity}`,
    getRoomService: () => ({
        listParticipants: async (room: string) => {
            if (media.fail) throw new Error('synthetic LiveKit outage');
            return [...(media.rooms.get(room) ?? new Set())].map((identity) => ({ identity }));
        },
        removeParticipant: async (room: string, identity: string) => {
            media.rooms.get(room)?.delete(identity);
        },
    }),
}));

import { parseCommerceCommand } from '@/lib/commerce-contract';
import {
    applyCommerceCommand,
    finalizeTicketTokenIssue,
    getCommerceEntitlement,
} from '@/lib/commerce-entitlement';
import { prisma } from '@/lib/db';
import { processNextCommerceMediaJob } from '@/lib/commerce-media-reconciler';
import { digestSessionToken } from '@/lib/session-auth';

const integration = process.env.COMMERCE_INTEGRATION_TEST === '1' ? describe : describe.skip;
const NOW = new Date('2026-08-01T04:00:00.000Z');
const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const FACILITATOR_ID = '10000000-0000-4000-8000-000000000099';
const GRANT_ID = '30000000-0000-4000-8000-000000000003';

function command(overrides: Record<string, unknown> = {}) {
    return parseCommerceCommand({
        schema_version: 'commerce-entitlement.command.v1',
        request_id: '40000000-0000-4000-8000-000000000001',
        source: 'PMP_MYTH_BOT',
        provider: 'TICKET_TAILOR',
        provision_revision: 1,
        desired_provider_state: 'ACTIVE',
        reason_code: 'PAYMENT_VERIFIED',
        external_order_id: 'tt-order-integration-1',
        external_ticket_id: 'tt-ticket-integration-1',
        registration_id: '20000000-0000-4000-8000-000000000002',
        scheduled_session_id: SESSION_ID,
        bound_email: ' Person@Example.com ',
        tier: 'GLOBAL_SOUTH',
        provider_observed_at: '2026-08-01T04:00:00.000Z',
        grant: {
            grant_id: GRANT_ID,
            generation: 1,
            derivation_key_version: 1,
            code: 'HB1-ABCD-EFGH-JKMP-QRST-UVWX-YZ23-4567-89AB',
        },
        ...overrides,
    });
}

integration('commerce entitlement PostgreSQL contract', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('commerce integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error(
                'commerce integration cleanup is restricted to the exact configured *_test database',
            );
        }
        media.fail = false;
        media.rooms.clear();
        await prisma.auditLog.deleteMany();
        await prisma.commerceRequestReceipt.deleteMany();
        await prisma.commerceEntitlementCommand.deleteMany();
        await prisma.commerceMediaOutbox.deleteMany();
        await prisma.commerceEntitlement.deleteMany();
        await prisma.webSession.deleteMany();
        await prisma.sessionParticipant.deleteMany();
        await prisma.ticketEntitlement.deleteMany();
        await prisma.scheduledSession.deleteMany();
        await prisma.user.deleteMany();
        await prisma.user.create({
            data: {
                id: FACILITATOR_ID,
                email: 'facilitator@integration.invalid',
                name: 'Integration facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
        await prisma.scheduledSession.create({
            data: {
                id: SESSION_ID,
                title: 'Commerce integration',
                roomName: 'commerce-integration',
                language: 'SPANISH',
                scheduledAt: new Date('2026-08-02T14:30:00.000Z'),
                status: 'LIVE',
                paidMode: true,
                attendeeCap: 150,
                facilitatorId: FACILITATOR_ID,
            },
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('applies, replays, rotates, returns current binding to stale, and revokes', async () => {
        const first = command();
        const applied = await applyCommerceCommand(first, first.external_ticket_id, NOW);
        expect(applied).toMatchObject({
            outcome: 'APPLIED',
            applied_revision: 1,
            effective_state: 'ACTIVE',
            credential_action: 'CREATED',
            credential_binding: { grant_id: GRANT_ID, generation: 1, derivation_key_version: 1 },
        });
        await expect(prisma.commerceEntitlement.findFirstOrThrow()).resolves.toMatchObject({
            livekitIdentityVersion: 1,
        });
        await expect(prisma.auditLog.findFirst({
            where: { action: 'commerce.entitlement_apply' },
        })).resolves.toMatchObject({
            targetType: 'COMMERCE_ENTITLEMENT',
            reason: 'PAYMENT_VERIFIED',
            metadata: expect.objectContaining({ revision: 1, credentialAction: 'CREATED' }),
        });

        const replay = command({ request_id: '40000000-0000-4000-8000-000000000002' });
        await expect(applyCommerceCommand(replay, replay.external_ticket_id, NOW)).resolves.toMatchObject({
            outcome: 'REPLAYED',
            credential_binding: { generation: 1 },
        });

        const row = await prisma.commerceEntitlement.findUniqueOrThrow({
            where: { provider_externalTicketId: { provider: 'TICKET_TAILOR', externalTicketId: first.external_ticket_id } },
        });
        await prisma.webSession.create({
            data: {
                tokenDigest: digestSessionToken('commerce-cookie-value'),
                ticketEntitlementId: row.ticketEntitlementId,
                expiresAt: new Date('2026-08-03T00:00:00.000Z'),
            },
        });
        await prisma.sessionParticipant.create({
            data: {
                scheduledSessionId: SESSION_ID,
                ticketEntitlementId: row.ticketEntitlementId,
                participantIdentity: 'event-commerce-participant',
            },
        });
        const tokenHorizon = new Date(NOW.getTime() + 5 * 60_000);
        await expect(finalizeTicketTokenIssue(
            'commerce-cookie-value',
            row.ticketEntitlementId,
            tokenHorizon,
            NOW,
        )).resolves.toBe(true);

        const rotated = command({
            request_id: '40000000-0000-4000-8000-000000000003',
            provision_revision: 2,
            reason_code: 'CREDENTIAL_ROTATED',
            provider_observed_at: '2026-08-01T04:01:00.000Z',
            grant: {
                grant_id: GRANT_ID,
                generation: 2,
                derivation_key_version: 1,
                code: 'HB1-BCDE-FGHJ-KMPQ-RSTU-VWXY-Z234-5678-9ABC',
            },
        });
        await expect(applyCommerceCommand(rotated, rotated.external_ticket_id, NOW)).resolves.toMatchObject({
            outcome: 'APPLIED',
            applied_revision: 2,
            credential_action: 'ROTATED',
            credential_binding: { generation: 2 },
            web_sessions_revoked_on_apply: 1,
            reconciliation_required: true,
        });
        await expect(prisma.commerceEntitlement.findFirstOrThrow()).resolves.toMatchObject({
            livekitIdentityVersion: 2,
        });

        const stale = command({ request_id: '40000000-0000-4000-8000-000000000004' });
        await expect(applyCommerceCommand(stale, stale.external_ticket_id, NOW)).resolves.toMatchObject({
            outcome: 'STALE',
            applied_revision: 2,
            credential_binding: { generation: 2 },
        });

        const revoked = command({
            request_id: '40000000-0000-4000-8000-000000000005',
            provision_revision: 3,
            desired_provider_state: 'REVOKED',
            reason_code: 'TICKET_VOIDED',
            provider_observed_at: '2026-08-01T04:02:00.000Z',
            grant: null,
        });
        await expect(applyCommerceCommand(revoked, revoked.external_ticket_id, NOW)).resolves.toMatchObject({
            outcome: 'APPLIED',
            effective_state: 'REVOKED',
            credential_action: 'REVOKED',
            credential_binding: null,
        });
        await expect(finalizeTicketTokenIssue(
            'commerce-cookie-value',
            row.ticketEntitlementId,
            new Date(NOW.getTime() + 10 * 60_000),
            NOW,
        )).resolves.toBe(false);
        await expect(getCommerceEntitlement(first.external_ticket_id, NOW)).resolves.toMatchObject({
            applied_revision: 3,
            credential_binding: null,
        });

        await prisma.commerceEntitlement.update({
            where: { id: row.id },
            data: { administrativeState: 'SUSPENDED' },
        });
        const providerReactivated = command({
            request_id: '40000000-0000-4000-8000-000000000006',
            provision_revision: 4,
            reason_code: 'PROVIDER_RECONCILED',
            provider_observed_at: '2026-08-01T04:03:00.000Z',
            grant: {
                grant_id: GRANT_ID,
                generation: 3,
                derivation_key_version: 2,
                code: 'HB1-EFGH-JKMP-QRST-UVWX-YZ23-4567-89AB-CDEF',
            },
        });
        await expect(applyCommerceCommand(
            providerReactivated,
            providerReactivated.external_ticket_id,
            NOW,
        )).resolves.toMatchObject({
            effective_state: 'SUSPENDED',
            administrative_state: 'SUSPENDED',
            credential_binding: { generation: 3, derivation_key_version: 2 },
        });
        await expect(prisma.commerceEntitlement.findFirstOrThrow()).resolves.toMatchObject({
            livekitIdentityVersion: 3,
        });
        await expect(prisma.ticketEntitlement.findUniqueOrThrow({
            where: { id: row.ticketEntitlementId },
        })).resolves.toMatchObject({ state: 'REVOKED' });

        const regressed = command({
            request_id: '40000000-0000-4000-8000-000000000007',
            provision_revision: 5,
            grant: {
                grant_id: GRANT_ID,
                generation: 2,
                derivation_key_version: 1,
                code: 'HB1-BCDE-FGHJ-KMPQ-RSTU-VWXY-Z234-5678-9ABC',
            },
        });
        await expect(applyCommerceCommand(regressed, regressed.external_ticket_id, NOW)).rejects.toMatchObject({
            code: 'generation_regressed',
        });
    });

    it('rejects a request id reused with different material', async () => {
        const reused = command({
            request_id: '40000000-0000-4000-8000-000000000001',
            provision_revision: 9,
            provider_observed_at: '2026-08-01T04:09:00.000Z',
        });
        await expect(applyCommerceCommand(reused, reused.external_ticket_id, NOW)).rejects.toMatchObject({
            code: 'request_id_reused',
        });
    });

    it('owns retries durably, isolates identities, and recovers stale PROCESSING jobs', async () => {
        media.rooms.set('commerce-integration', new Set([
            'event-commerce-participant',
            'event-commerce-participant-v3',
            'other-event',
        ]));
        media.rooms.set('beacon', new Set([
            'bed-event-commerce-participant',
            'bed-event-commerce-participant-v3',
            'playlist-bot',
            'bed-other-event',
        ]));

        expect(await processNextCommerceMediaJob(NOW)).toBe(true);
        expect(media.rooms.get('commerce-integration')).toEqual(new Set([
            'event-commerce-participant-v3',
            'other-event',
        ]));
        expect(media.rooms.get('beacon')).toEqual(new Set([
            'bed-event-commerce-participant-v3',
            'playlist-bot',
            'bed-other-event',
        ]));
        expect(await prisma.commerceMediaOutbox.count({ where: { status: 'PENDING' } })).toBe(3);

        // A token minted before revocation may reconnect until its five-minute
        // horizon; the later revocation job removes only the same identity.
        media.rooms.get('commerce-integration')?.add('event-commerce-participant');
        media.rooms.get('beacon')?.add('bed-event-commerce-participant');
        expect(await processNextCommerceMediaJob(NOW)).toBe(true);
        expect(media.rooms.get('commerce-integration')).toEqual(new Set([
            'event-commerce-participant-v3',
            'other-event',
        ]));
        expect(media.rooms.get('beacon')).toEqual(new Set([
            'bed-event-commerce-participant-v3',
            'playlist-bot',
            'bed-other-event',
        ]));
        expect(await processNextCommerceMediaJob(NOW)).toBe(true);

        const afterHorizon = new Date(NOW.getTime() + 5 * 60_000 + 1);
        expect(await processNextCommerceMediaJob(afterHorizon)).toBe(true);
        expect(await processNextCommerceMediaJob(afterHorizon)).toBe(true);
        expect(await processNextCommerceMediaJob(afterHorizon)).toBe(true);
        expect(await prisma.commerceMediaOutbox.count({ where: { status: 'COMPLETED' } })).toBe(3);

        const entitlement = await prisma.commerceEntitlement.findFirstOrThrow();
        await prisma.commerceMediaOutbox.create({
            data: {
                commerceEntitlementId: entitlement.id,
                provisionRevision: 99,
                stageRoomName: 'commerce-integration',
                participantIdentity: 'event-commerce-participant',
                bedIdentity: 'bed-event-commerce-participant',
                tokenHorizonAt: new Date(NOW.getTime() - 1),
                status: 'PROCESSING',
                lastAttemptAt: new Date(NOW.getTime() - 61_000),
            },
        });
        media.rooms.get('commerce-integration')?.add('event-commerce-participant');
        media.rooms.get('beacon')?.add('bed-event-commerce-participant');
        expect(await processNextCommerceMediaJob(NOW)).toBe(true);
        await expect(prisma.commerceMediaOutbox.findUniqueOrThrow({
            where: {
                commerceEntitlementId_provisionRevision: {
                    commerceEntitlementId: entitlement.id,
                    provisionRevision: 99,
                },
            },
        })).resolves.toMatchObject({ status: 'COMPLETED', attempts: 1 });

        await prisma.commerceMediaOutbox.create({
            data: {
                commerceEntitlementId: entitlement.id,
                provisionRevision: 100,
                stageRoomName: 'commerce-integration',
                participantIdentity: 'event-commerce-participant',
                bedIdentity: 'bed-event-commerce-participant',
                tokenHorizonAt: new Date(NOW.getTime() - 1),
                nextAttemptAt: NOW,
            },
        });
        media.fail = true;
        expect(await processNextCommerceMediaJob(NOW)).toBe(true);
        await expect(prisma.commerceMediaOutbox.findUniqueOrThrow({
            where: {
                commerceEntitlementId_provisionRevision: {
                    commerceEntitlementId: entitlement.id,
                    provisionRevision: 100,
                },
            },
        })).resolves.toMatchObject({ status: 'PENDING', lastErrorCode: 'LIVEKIT_UNAVAILABLE' });
        media.fail = false;
        expect(await processNextCommerceMediaJob(new Date(NOW.getTime() + 10_000))).toBe(true);
    });

    it('serializes different resources on the last event seat', async () => {
        await prisma.ticketEntitlement.createMany({
            data: Array.from({ length: 148 }, (_, index) => ({
                scheduledSessionId: SESSION_ID,
                codeDigest: `legacy-cap-${index}`,
                codeLastFour: String(index).padStart(4, '0'),
                tier: 'GLOBAL_NORTH' as const,
                state: 'ISSUED' as const,
                expiresAt: new Date('2026-08-03T00:00:00.000Z'),
            })),
        });
        const first = command({
            request_id: '40000000-0000-4000-8000-000000000011',
            external_order_id: 'tt-order-cap-a',
            external_ticket_id: 'tt-ticket-cap-a',
            registration_id: '20000000-0000-4000-8000-000000000011',
            grant: {
                grant_id: '30000000-0000-4000-8000-000000000011',
                generation: 1,
                derivation_key_version: 1,
                code: 'HB1-CDEF-GHJK-MPQR-STUV-WXYZ-2345-6789-ABCD',
            },
        });
        const second = command({
            request_id: '40000000-0000-4000-8000-000000000012',
            external_order_id: 'tt-order-cap-b',
            external_ticket_id: 'tt-ticket-cap-b',
            registration_id: '20000000-0000-4000-8000-000000000012',
            grant: {
                grant_id: '30000000-0000-4000-8000-000000000012',
                generation: 1,
                derivation_key_version: 1,
                code: 'HB1-FGHJ-KMPQ-RSTU-VWXY-Z234-5678-9ABC-DEFG',
            },
        });
        const outcomes = await Promise.allSettled([
            applyCommerceCommand(first, first.external_ticket_id, NOW),
            applyCommerceCommand(second, second.external_ticket_id, NOW),
        ]);
        expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(({ status }) => status === 'rejected');
        expect(rejected).toMatchObject({ reason: { code: 'capacity_exceeded' } });
        expect(await prisma.ticketEntitlement.count({
            where: {
                scheduledSessionId: SESSION_ID,
                OR: [
                    { commerceEntitlement: { is: { providerState: 'ACTIVE' } } },
                    { commerceEntitlement: { is: null }, state: { not: 'REVOKED' } },
                ],
            },
        })).toBe(150);
    });

    it('accepts a revocation tombstone even after the event closes', async () => {
        await prisma.scheduledSession.update({
            where: { id: SESSION_ID },
            data: { status: 'ENDED', endedAt: NOW },
        });
        const tombstone = command({
            request_id: '40000000-0000-4000-8000-000000000020',
            external_order_id: 'tt-order-late-void',
            external_ticket_id: 'tt-ticket-late-void',
            registration_id: '20000000-0000-4000-8000-000000000020',
            desired_provider_state: 'REVOKED',
            reason_code: 'TICKET_VOIDED',
            grant: null,
        });
        await expect(applyCommerceCommand(
            tombstone,
            tombstone.external_ticket_id,
            NOW,
        )).resolves.toMatchObject({
            outcome: 'APPLIED',
            provider_state: 'REVOKED',
            credential_binding: null,
        });
        const lateActivation = command({
            request_id: '40000000-0000-4000-8000-000000000021',
            external_order_id: 'tt-order-late-active',
            external_ticket_id: 'tt-ticket-late-active',
            registration_id: '20000000-0000-4000-8000-000000000021',
            grant: {
                grant_id: '30000000-0000-4000-8000-000000000021',
                generation: 1,
                derivation_key_version: 1,
                code: 'HB1-GHJK-MPQR-STUV-WXYZ-2345-6789-ABCD-EFGH',
            },
        });
        await expect(applyCommerceCommand(
            lateActivation,
            lateActivation.external_ticket_id,
            NOW,
        )).rejects.toMatchObject({ code: 'session_unavailable' });
    });
});
