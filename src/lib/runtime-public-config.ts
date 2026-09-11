const EXACT_IMAGE = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/;
const EXACT_DIGEST = /^sha256:[0-9a-f]{64}$/;

type Environment = Record<string, string | undefined>;

export type RuntimePublicConfigProvenance = {
    publicOrigin: string | null;
    artifactDigest: string | null;
    configProfileSha256: string | null;
};

function publicOrigin(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
        return url.origin;
    } catch {
        return null;
    }
}

/** Public, non-secret runtime values that the root helper binds to the reviewed profile. */
export function runtimePublicConfig(
    environment: Environment = process.env,
): RuntimePublicConfigProvenance {
    const artifactDigest = environment.BEACON_ARTIFACT_DIGEST ?? '';
    const configProfileSha256 = environment.BEACON_CONFIG_PROFILE_SHA256 ?? '';
    return {
        publicOrigin: publicOrigin(environment.BEACON_PUBLIC_ORIGIN),
        artifactDigest: EXACT_IMAGE.test(artifactDigest) ? artifactDigest : null,
        configProfileSha256: EXACT_DIGEST.test(configProfileSha256) ? configProfileSha256 : null,
    };
}
