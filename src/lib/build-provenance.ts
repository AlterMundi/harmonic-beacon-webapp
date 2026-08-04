export const HEALTH_SCHEMA_VERSION = 'health.response.v2';
export const COMMERCE_ENTITLEMENT_CONTRACT_VERSION = 'commerce-entitlement.v1';

type Environment = Record<string, string | undefined>;

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const UTC_BUILD_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DATABASE_SCHEMA_VERSION = /^\d{14}_[a-z0-9_]+$/;

export type BuildProvenance = {
    gitSha: string;
    buildTime: string | null;
    databaseSchemaVersion: string;
    contractVersions: {
        commerceEntitlement: typeof COMMERCE_ENTITLEMENT_CONTRACT_VERSION;
    };
};

/**
 * Expose only validated, non-sensitive build metadata. Missing local build
 * arguments remain explicit instead of pretending to identify a release.
 */
export function buildProvenance(environment: Environment): BuildProvenance {
    const gitSha = environment.BEACON_GIT_SHA?.toLowerCase() ?? '';
    const buildTime = environment.BEACON_BUILD_TIME ?? '';
    const databaseSchemaVersion = environment.BEACON_DATABASE_SCHEMA_VERSION ?? '';

    return {
        gitSha: FULL_GIT_SHA.test(gitSha) ? gitSha : 'unknown',
        buildTime: UTC_BUILD_TIME.test(buildTime) ? buildTime : null,
        databaseSchemaVersion: DATABASE_SCHEMA_VERSION.test(databaseSchemaVersion)
            ? databaseSchemaVersion
            : 'unknown',
        contractVersions: {
            commerceEntitlement: COMMERCE_ENTITLEMENT_CONTRACT_VERSION,
        },
    };
}
