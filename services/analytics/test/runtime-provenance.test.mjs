import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runtimeProvenance } from '../src/runtime-provenance.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const IMAGE_DIGEST = `sha256:${'c'.repeat(64)}`;
const CONFIG_SHA = `sha256:${'d'.repeat(64)}`;

test('health provenance is verified only when build and runtime evidence agree', () => {
  assert.deepEqual(runtimeProvenance({
    ANALYTICS_BUILD_REVISION: SOURCE_SHA,
    ANALYTICS_EXPECTED_SOURCE_REVISION: SOURCE_SHA,
    ANALYTICS_ARTIFACT_IMAGE_ID: IMAGE_ID,
    ANALYTICS_ARTIFACT_DIGEST: IMAGE_DIGEST,
    ANALYTICS_CONFIG_SHA256: CONFIG_SHA,
  }), {
    schemaVersion: 'hb.analytics.provenance.v1',
    verified: true,
    sourceRevision: SOURCE_SHA,
    artifact: {
      imageId: IMAGE_ID,
      digest: IMAGE_DIGEST,
      revision: SOURCE_SHA,
    },
    configSha256: CONFIG_SHA,
  });
});

test('collector health and readiness add provenance without replacing legacy status fields', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const compose = await readFile(new URL('../../../ops/analytics/compose.yml', import.meta.url), 'utf8');
  assert.match(server, /status: 'ok'.*provenance/);
  assert.match(server, /status: 'ready'.*provenance/);
  assert.match(server, /status: 'not_ready'.*provenance/);
  assert.match(dockerfile, /ARG ANALYTICS_SOURCE_REVISION=unknown/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(compose, /ANALYTICS_EXPECTED_SOURCE_REVISION/);
  assert.match(compose, /ANALYTICS_ARTIFACT_IMAGE_ID/);
  assert.match(compose, /ANALYTICS_ARTIFACT_DIGEST/);
  assert.match(compose, /ANALYTICS_CONFIG_SHA256/);
});

test('health provenance reports unknown without leaking invalid or mismatched inputs', () => {
  const provenance = runtimeProvenance({
    ANALYTICS_BUILD_REVISION: SOURCE_SHA,
    ANALYTICS_EXPECTED_SOURCE_REVISION: 'e'.repeat(40),
    ANALYTICS_ARTIFACT_IMAGE_ID: '/home/operator/private/image',
    ANALYTICS_ARTIFACT_DIGEST: 'token=secret',
    ANALYTICS_CONFIG_SHA256: '/etc/harmonic-beacon/analytics.env',
  });
  assert.deepEqual(provenance, {
    schemaVersion: 'hb.analytics.provenance.v1',
    verified: false,
    sourceRevision: 'unknown',
    artifact: { imageId: 'unknown', digest: 'unknown', revision: 'unknown' },
    configSha256: 'unknown',
  });
  assert.doesNotMatch(JSON.stringify(provenance), /home|operator|token|secret|etc/);
});
