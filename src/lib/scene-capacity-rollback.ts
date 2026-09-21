import { Prisma, type PrismaClient } from '@prisma/client';

export const SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA =
    'harmonic-beacon.scene-capacity-rollback-preflight.v2' as const;
export const SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE =
    'scene-capacity-rollback-read-only-v2' as const;

type InspectedSession = {
    id: string;
    sceneCapacity: number;
    legacyMaxPublishers: number;
    activePublisherGrants: number;
};

type ReportedNonSixSession = Omit<InspectedSession, 'legacyMaxPublishers'>;

export class SceneCapacityRollbackPreflightError extends Error {
    constructor(
        public readonly code:
            | 'active_grants_exceed_rollback_capacity'
            | 'unsupported_persisted_capacity'
            | 'legacy_capacity_invariant_violated',
        message: string,
        public readonly unsafeSessions: InspectedSession[] = [],
    ) {
        super(message);
        this.name = 'SceneCapacityRollbackPreflightError';
    }
}

type RollbackPrisma = Pick<PrismaClient, '$transaction'>;

export async function verifySceneCapacityRollbackSafety(
    prisma: RollbackPrisma,
    now = new Date(),
) {
    return prisma.$transaction(async (tx) => {
        // The deployment helper fences entry and stops both app/reconciler
        // writers before this barrier. These locks make the final inspection
        // stable and fail closed if an unexpected writer still exists.
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '30s'");
        await tx.$executeRawUnsafe(
            'LOCK TABLE "scheduled_sessions", "session_participants" IN ACCESS EXCLUSIVE MODE',
        );
        await tx.$queryRawUnsafe<Array<{ id: string }>>(`
            SELECT "id"::text AS "id"
            FROM "scheduled_sessions"
            ORDER BY "id"
            FOR UPDATE
        `);

        const rows = await tx.$queryRawUnsafe<InspectedSession[]>(`
            SELECT
                s."id"::text AS "id",
                s."scene_capacity" AS "sceneCapacity",
                s."max_publishers" AS "legacyMaxPublishers",
                COUNT(p."id") FILTER (
                    WHERE p."publish_granted_at" IS NOT NULL
                      AND p."publish_revoked_at" IS NULL
                )::integer AS "activePublisherGrants"
            FROM "scheduled_sessions" s
            LEFT JOIN "session_participants" p
              ON p."scheduled_session_id" = s."id"
            GROUP BY s."id", s."scene_capacity", s."max_publishers"
            ORDER BY s."id"
        `);

        const unsupported = rows.filter(({ sceneCapacity }) => ![6, 9, 12].includes(sceneCapacity));
        if (unsupported.length > 0) {
            throw new SceneCapacityRollbackPreflightError(
                'unsupported_persisted_capacity',
                'Rollback refused: unsupported persisted scene capacity',
                unsupported,
            );
        }

        const invalidLegacyRows = rows.filter(({ legacyMaxPublishers }) => legacyMaxPublishers !== 6);
        if (invalidLegacyRows.length > 0) {
            throw new SceneCapacityRollbackPreflightError(
                'legacy_capacity_invariant_violated',
                'Rollback refused: the legacy max_publishers invariant is not fixed at six',
                invalidLegacyRows,
            );
        }

        const unsafe = rows.filter(({ activePublisherGrants }) => activePublisherGrants > 6);
        if (unsafe.length > 0) {
            throw new SceneCapacityRollbackPreflightError(
                'active_grants_exceed_rollback_capacity',
                'Rollback refused: a session has more than six active publisher grants',
                unsafe,
            );
        }

        const nonSixConfiguredSessions: ReportedNonSixSession[] = rows
            .filter(({ sceneCapacity }) => sceneCapacity !== 6)
            .map(({ id, sceneCapacity, activePublisherGrants }) => ({
                id,
                sceneCapacity,
                activePublisherGrants,
            }));

        return {
            schemaVersion: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
            procedure: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
            eligibleForOldBinaryRollback: true as const,
            inspectedSessions: rows.length,
            verifiedUnsafeSessions: 0 as const,
            legacyMaxPublishersVerified: true as const,
            nonSixConfiguredSessions,
            inspectedAt: now.toISOString(),
        };
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 60_000,
    });
}
