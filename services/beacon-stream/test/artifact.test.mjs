import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { loadArtifact, verifyArtifactFiles } from '../src/artifact.mjs';
import { metadata, temporaryArtifact, temporaryVariableArtifact, variableMetadata } from './helpers.mjs';

test('requires explicit approval and exactly six-second immutable segment metadata', () => {
  assert.throws(() => metadata({ approval: { status: 'PENDING' } }), /not explicitly approved/);
  assert.throws(() => metadata({ timing: { epochUtc: '2026-08-06T00:00:00.000Z', segmentDurationSeconds: 5, segmentCount: 3 } }), /six-second/);
  assert.throws(() => metadata({ timing: { epochUtc: '2026-08-06T00:00:00', segmentDurationSeconds: 6, segmentCount: 3 } }), /UTC timestamp/);
});

test('accepts an fMP4 initialization file and measured final segment duration', async () => {
  const item = variableMetadata();
  assert.equal(item.loopDurationSeconds, 16);
  assert.deepEqual(item.segmentStartsSeconds, [0, 6, 12]);
  assert.equal(item.segmentByFile.has('init.mp4'), true);
  const artifact = await temporaryVariableArtifact();
  await verifyArtifactFiles(await loadArtifact({ mediaRoot: artifact.mediaRoot, artifactId: 'approved-v2' }));
});

test('rejects variable segment timing that does not equal the loop duration', () => {
  assert.throws(() => variableMetadata({
    timing: { epochUtc: '2026-08-06T00:00:00.000Z', targetSegmentDurationSeconds: 6, segmentCount: 3, loopDurationSeconds: 18 },
  }), /do not match/);
});

test('loads and checksum-verifies every immutable segment', async () => {
  const { mediaRoot, artifactRoot } = await temporaryArtifact();
  const loaded = await loadArtifact({ mediaRoot, artifactId: 'approved-v1' });
  await verifyArtifactFiles(loaded);
  await fs.writeFile(`${artifactRoot}/segments/00001.m4s`, 'bad');
  await assert.rejects(() => verifyArtifactFiles(loaded), /checksum changed/);
});
