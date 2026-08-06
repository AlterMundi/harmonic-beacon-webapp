import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { loadArtifact, verifyArtifactFiles } from '../src/artifact.mjs';
import { metadata, temporaryArtifact } from './helpers.mjs';

test('requires explicit approval and exactly six-second immutable segment metadata', () => {
  assert.throws(() => metadata({ approval: { status: 'PENDING' } }), /not explicitly approved/);
  assert.throws(() => metadata({ timing: { epochUtc: '2026-08-06T00:00:00.000Z', segmentDurationSeconds: 5, segmentCount: 3 } }), /six-second/);
});

test('loads and checksum-verifies every immutable segment', async () => {
  const { mediaRoot, artifactRoot } = await temporaryArtifact();
  const loaded = await loadArtifact({ mediaRoot, artifactId: 'approved-v1' });
  await verifyArtifactFiles(loaded);
  await fs.writeFile(`${artifactRoot}/segments/00001.m4s`, 'bad');
  await assert.rejects(() => verifyArtifactFiles(loaded), /checksum changed/);
});
