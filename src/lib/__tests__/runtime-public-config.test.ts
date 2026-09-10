import { describe, expect, it } from 'vitest';

import { runtimePublicConfig } from '@/lib/runtime-public-config';

const HASH = `sha256:${'a'.repeat(64)}`;
const REF = `ghcr.io/altermundi/harmonic-beacon-app@sha256:${'b'.repeat(64)}`;

describe('runtime public config provenance', () => {
    it('exposes only validated non-secret runtime provenance', () => {
        expect(runtimePublicConfig({
            BEACON_PUBLIC_ORIGIN: 'https://live.harmonicbeacon.com',
            BEACON_ARTIFACT_DIGEST: REF,
            BEACON_CONFIG_PROFILE_SHA256: HASH,
        })).toEqual({
            publicOrigin: 'https://live.harmonicbeacon.com',
            artifactDigest: REF,
            configProfileSha256: HASH,
        });
    });

    it('fails closed for pathful origins and mutable image references', () => {
        expect(runtimePublicConfig({
            BEACON_PUBLIC_ORIGIN: 'https://live.harmonicbeacon.com/path',
            BEACON_ARTIFACT_DIGEST: 'ghcr.io/altermundi/harmonic-beacon-app:latest',
            BEACON_CONFIG_PROFILE_SHA256: 'unverified',
        })).toEqual({ publicOrigin: null, artifactDigest: null, configProfileSha256: null });
    });
});
