import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
    SceneCapacityRollbackPreflightError,
    verifySceneCapacityRollbackSafety,
} from '@/lib/scene-capacity-rollback';

const integration = process.env.SCENE_CAPACITY_ROLLBACK_INTEGRATION_TEST === '1'
    ? describe
    : describe.skip;

const SESSION_IDS = {
    6: '94000000-0000-4000-8000-000000000006',
    9: '94000000-0000-4000-8000-000000000009',
    12: '94000000-0000-4000-8000-000000000012',
} as const;
const FACILITATOR_ID = '95000000-0000-4000-8000-000000000001';
const ALL_SESSION_IDS = Object.values(SESSION_IDS);
const NOW = new Date('2026-09-16T03:00:00.000Z');

function activeGrantTicketId(sessionId: string, index: number) {
    const suffix = `${sessionId.slice(-3)}${String(index).padStart(9, '0')}`;
    return `96000000-0000-4000-8000-${suffix}`;
}

function activeGrantFixtures(sessionId: string, count: number) {
    return Array.from({ length: count }, (_, index) => ({
        scheduledSessionId: sessionId,
        participantIdentity: `${sessionId}-publisher-${index}`,
        ticketEntitlementId: activeGrantTicketId(sessionId, index),
        publishGrantedAt: NOW,
        grantVersion: 1,
        grantReason: 'rollback integration fixture',
    }));
}

describe('scene capacity rollback integration fixture contract', () => {
    it('gives every active grant exactly one durable principal', () => {
        for (const participant of activeGrantFixtures(SESSION_IDS[12], 7)) {
            const fixture = participant as {
                ticketEntitlementId?: string | null;
                staffUserId?: string | null;
            };
            expect(Number(Boolean(fixture.ticketEntitlementId)) + Number(Boolean(fixture.staffUserId)))
                .toBe(1);
        }
    });
});

async function createSession(sceneCapacity: 6 | 9 | 12) {
    const id = SESSION_IDS[sceneCapacity];
    await prisma.scheduledSession.create({
        data: {
            id,
            title: `Scene capacity rollback ${sceneCapacity}`,
            roomName: `scene-capacity-rollback-${sceneCapacity}`,
            language: 'SPANISH',
            scheduledAt: NOW,
            status: 'SCHEDULED',
            paidMode: false,
            attendeeCap: 12,
            maxPublishers: sceneCapacity,
            facilitatorId: FACILITATOR_ID,
        },
    });
    return id;
}

async function createActiveGrants(sessionId: string, count: number) {
    await prisma.ticketEntitlement.createMany({
        data: Array.from({ length: count }, (_, index) => {
            const id = activeGrantTicketId(sessionId, index);
            return {
                id,
                scheduledSessionId: sessionId,
                codeDigest: id.replaceAll('-', '').padEnd(64, '0'),
                codeLastFour: id.slice(-4),
                tier: 'COMP' as const,
                state: 'ISSUED' as const,
                expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
            };
        }),
    });
    await prisma.sessionParticipant.createMany({
        data: activeGrantFixtures(sessionId, count),
    });
}

async function cleanup() {
    await prisma.sessionParticipant.deleteMany({
        where: { scheduledSessionId: { in: ALL_SESSION_IDS } },
    });
    await prisma.scheduledSession.deleteMany({ where: { id: { in: ALL_SESSION_IDS } } });
}

integration('scene capacity rollback PostgreSQL compatibility', () => {
    beforeAll(async () => {
        const configured = process.env.DATABASE_URL;
        if (!configured) throw new Error('scene capacity rollback integration DATABASE_URL is required');
        const expectedDatabase = new URL(configured).pathname.replace(/^\//, '');
        const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`
            SELECT current_database() AS "database"
        `;
        if (!expectedDatabase.endsWith('_test') || database !== expectedDatabase) {
            throw new Error('scene capacity rollback integration is restricted to the exact configured *_test database');
        }
        await cleanup();
        await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
        await prisma.user.create({
            data: {
                id: FACILITATOR_ID,
                email: 'scene-capacity-rollback@integration.invalid',
                name: 'Rollback facilitator',
                role: 'FACILITATOR',
                passwordDigest: 'not-used',
            },
        });
    });

    beforeEach(cleanup);

    afterAll(async () => {
        await cleanup();
        await prisma.user.deleteMany({ where: { id: FACILITATOR_ID } });
        await prisma.$disconnect();
    });

    it('preserves scene_capacity 9/12, fixed-six legacy values, and audit rows for safe sessions', async () => {
        for (const sceneCapacity of [6, 9, 12] as const) {
            const sessionId = await createSession(sceneCapacity);
            await createActiveGrants(sessionId, sceneCapacity === 12 ? 6 : sceneCapacity === 9 ? 3 : 6);
        }
        const auditCountBefore = await prisma.auditLog.count();

        const result = await verifySceneCapacityRollbackSafety(prisma, NOW);

        expect(result).toMatchObject({
            eligibleForOldBinaryRollback: true,
            verifiedUnsafeSessions: 0,
            legacyMaxPublishersVerified: true,
        });
        expect(result.inspectedSessions).toBeGreaterThanOrEqual(3);
        expect(result.nonSixConfiguredSessions).toEqual(expect.arrayContaining([
            { id: SESSION_IDS[9], sceneCapacity: 9, activePublisherGrants: 3 },
            { id: SESSION_IDS[12], sceneCapacity: 12, activePublisherGrants: 6 },
        ]));
        const rows = await prisma.$queryRaw<Array<{
            id: string;
            sceneCapacity: number;
            legacyMaxPublishers: number;
        }>>`
            SELECT
                "id"::text AS "id",
                "scene_capacity" AS "sceneCapacity",
                "max_publishers" AS "legacyMaxPublishers"
            FROM "scheduled_sessions"
            WHERE "id"::text IN (${SESSION_IDS[6]}, ${SESSION_IDS[9]}, ${SESSION_IDS[12]})
            ORDER BY "id"
        `;
        expect(rows).toEqual([
            { id: SESSION_IDS[6], sceneCapacity: 6, legacyMaxPublishers: 6 },
            { id: SESSION_IDS[9], sceneCapacity: 9, legacyMaxPublishers: 6 },
            { id: SESSION_IDS[12], sceneCapacity: 12, legacyMaxPublishers: 6 },
        ]);
        await expect(prisma.auditLog.count()).resolves.toBe(auditCountBefore);
    });

    it.each([6, 9, 12] as const)(
        'fails closed without writes when a %i-capacity session has seven active grants',
        async (sceneCapacity) => {
            const sessionId = await createSession(sceneCapacity);
            await createActiveGrants(sessionId, 7);
            const auditCountBefore = await prisma.auditLog.count();

            await expect(verifySceneCapacityRollbackSafety(prisma, NOW)).rejects.toMatchObject({
                code: 'active_grants_exceed_rollback_capacity',
            } satisfies Partial<SceneCapacityRollbackPreflightError>);
            const [row] = await prisma.$queryRaw<Array<{
                sceneCapacity: number;
                legacyMaxPublishers: number;
            }>>`
                SELECT
                    "scene_capacity" AS "sceneCapacity",
                    "max_publishers" AS "legacyMaxPublishers"
                FROM "scheduled_sessions"
                WHERE "id"::text = ${sessionId}
            `;
            expect(row).toEqual({ sceneCapacity, legacyMaxPublishers: 6 });
            await expect(prisma.auditLog.count()).resolves.toBe(auditCountBefore);
        },
    );
});
