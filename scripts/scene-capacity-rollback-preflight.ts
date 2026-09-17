import { prisma } from '../src/lib/db';
import {
    SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
    SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
    SceneCapacityRollbackPreflightError,
    verifySceneCapacityRollbackSafety,
} from '../src/lib/scene-capacity-rollback';

async function main() {
    const result = await verifySceneCapacityRollbackSafety(prisma);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
    .catch((error: unknown) => {
        const failure = error instanceof SceneCapacityRollbackPreflightError
            ? {
                schemaVersion: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
                procedure: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
                eligibleForOldBinaryRollback: false,
                error: error.code,
                unsafeSessions: error.unsafeSessions,
            }
            : {
                schemaVersion: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_SCHEMA,
                procedure: SCENE_CAPACITY_ROLLBACK_PREFLIGHT_PROCEDURE,
                eligibleForOldBinaryRollback: false,
                error: 'preflight_failed',
            };
        process.stderr.write(`${JSON.stringify(failure)}\n`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
