const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export function runtimeProvenance(environment = process.env) {
  const buildRevision = environment.ANALYTICS_BUILD_REVISION;
  const expectedRevision = environment.ANALYTICS_EXPECTED_SOURCE_REVISION;
  const imageId = environment.ANALYTICS_ARTIFACT_IMAGE_ID;
  const digest = environment.ANALYTICS_ARTIFACT_DIGEST;
  const configSha256 = environment.ANALYTICS_CONFIG_SHA256;
  const verified = SHA40.test(buildRevision ?? '') &&
    buildRevision === expectedRevision &&
    SHA256.test(imageId ?? '') &&
    SHA256.test(digest ?? '') &&
    SHA256.test(configSha256 ?? '');

  if (!verified) {
    return {
      schemaVersion: 'hb.analytics.provenance.v1',
      verified: false,
      sourceRevision: 'unknown',
      artifact: { imageId: 'unknown', digest: 'unknown', revision: 'unknown' },
      configSha256: 'unknown',
    };
  }

  return {
    schemaVersion: 'hb.analytics.provenance.v1',
    verified: true,
    sourceRevision: buildRevision,
    artifact: { imageId, digest, revision: buildRevision },
    configSha256,
  };
}
