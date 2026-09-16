import { describe, expect, it, vi } from 'vitest';

import {
    SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
    SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
    SceneCapacityRollbackPreflightError,
    verifySceneCapacityRollbackSafety,
} from '../scene-capacity-rollback';

type StateSession = {
    id: string;
    sceneCapacity: number;
    legacyMaxPublishers: number;
    activePublisherGrants: number;
};

function harness(initial: StateSession[]) {
    const sessions = structuredClone(initial);
    const order: string[] = [];
    const sql: string[] = [];
    const tx = {
        $executeRawUnsafe: vi.fn(async (statement: string) => {
            sql.push(statement);
            order.push(statement.startsWith('SET LOCAL') ? 'lock-timeout' : 'table-lock');
            return 0;
        }),
        $queryRawUnsafe: vi.fn(async (statement: string) => {
            sql.push(statement);
            if (statement.includes('FOR UPDATE')) {
                order.push('row-lock');
                return sessions.map(({ id }) => ({ id }));
            }
            order.push('inspect');
            return sessions;
        }),
    };
    const prisma = {
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { prisma, tx, sessions, order, sql };
}

describe('read-only scene capacity rollback preflight', () => {
    it('locks and inspects every session while preserving configured 6/9/12 capacities', async () => {
        const fixture = harness([
            { id: 'persisted-12', sceneCapacity: 12, legacyMaxPublishers: 6, activePublisherGrants: 6 },
            { id: 'persisted-9', sceneCapacity: 9, legacyMaxPublishers: 6, activePublisherGrants: 3 },
            { id: 'persisted-6', sceneCapacity: 6, legacyMaxPublishers: 6, activePublisherGrants: 6 },
        ]);
        const now = new Date('2026-09-16T02:00:00.000Z');

        const result = await verifySceneCapacityRollbackSafety(fixture.prisma as never, now);

        expect(result).toEqual({
            schemaVersion: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
            procedure: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
            eligibleForOldBinaryRollback: true,
            inspectedSessions: 3,
            verifiedUnsafeSessions: 0,
            legacyMaxPublishersVerified: true,
            nonSixConfiguredSessions: [
                { id: 'persisted-12', sceneCapacity: 12, activePublisherGrants: 6 },
                { id: 'persisted-9', sceneCapacity: 9, activePublisherGrants: 3 },
            ],
            inspectedAt: now.toISOString(),
        });
        expect(fixture.sessions.map(({ sceneCapacity }) => sceneCapacity)).toEqual([12, 9, 6]);
        expect(fixture.order).toEqual(['lock-timeout', 'table-lock', 'row-lock', 'inspect']);
        expect(fixture.sql.join('\n')).toContain(
            'LOCK TABLE "scheduled_sessions", "session_participants" IN ACCESS EXCLUSIVE MODE',
        );
        expect(fixture.sql.join('\n')).toContain('s."scene_capacity"');
        expect(fixture.sql.join('\n')).toContain('s."max_publishers"');
        expect(fixture.sql.join('\n')).toContain('COUNT(p."id") FILTER');
        expect(Object.keys(fixture.tx).sort()).toEqual(['$executeRawUnsafe', '$queryRawUnsafe']);
    });

    it.each([6, 9, 12])(
        'fails closed when a %i-capacity session has seven active grants',
        async (sceneCapacity) => {
            const fixture = harness([{
                id: `unsafe-${sceneCapacity}`,
                sceneCapacity,
                legacyMaxPublishers: 6,
                activePublisherGrants: 7,
            }]);

            await expect(verifySceneCapacityRollbackSafety(fixture.prisma as never)).rejects.toMatchObject({
                code: 'active_grants_exceed_rollback_capacity',
                unsafeSessions: [{
                    id: `unsafe-${sceneCapacity}`,
                    sceneCapacity,
                    legacyMaxPublishers: 6,
                    activePublisherGrants: 7,
                }],
            });
            expect(fixture.sessions[0].sceneCapacity).toBe(sceneCapacity);
        },
    );

    it('fails closed on an unsupported configured capacity', async () => {
        const fixture = harness([{
            id: 'invalid-scene-capacity',
            sceneCapacity: 7,
            legacyMaxPublishers: 6,
            activePublisherGrants: 1,
        }]);

        await expect(verifySceneCapacityRollbackSafety(fixture.prisma as never)).rejects.toMatchObject({
            code: 'unsupported_persisted_capacity',
        } satisfies Partial<SceneCapacityRollbackPreflightError>);
    });

    it('fails closed when the fixed-six legacy column is not six', async () => {
        const fixture = harness([{
            id: 'invalid-legacy-capacity',
            sceneCapacity: 12,
            legacyMaxPublishers: 9,
            activePublisherGrants: 1,
        }]);

        await expect(verifySceneCapacityRollbackSafety(fixture.prisma as never)).rejects.toMatchObject({
            code: 'legacy_capacity_invariant_violated',
        } satisfies Partial<SceneCapacityRollbackPreflightError>);
    });
});
