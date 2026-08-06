import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateArtifact } from '../src/artifact.mjs';

export const SHA = 'a'.repeat(64);

export function metadata(overrides = {}) {
  return validateArtifact({
    schemaVersion: 1,
    artifactId: 'approved-v1',
    approval: { status: 'APPROVED', approvedAt: '2026-08-06T00:00:00.000Z', reviewRecord: 'audio-review-reference' },
    source: { masterSha256: SHA },
    derivative: { sha256: 'b'.repeat(64) },
    timing: { epochUtc: '2026-08-06T00:00:00.000Z', segmentDurationSeconds: 6, segmentCount: 3 },
    segments: [
      { file: '00000.m4s', bytes: 3, sha256: crypto.createHash('sha256').update('one').digest('hex') },
      { file: '00001.m4s', bytes: 3, sha256: crypto.createHash('sha256').update('two').digest('hex') },
      { file: '00002.m4s', bytes: 5, sha256: crypto.createHash('sha256').update('three').digest('hex') },
    ],
    ...overrides,
  });
}

export async function temporaryArtifact() {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-stream-'));
  const artifactRoot = path.join(mediaRoot, 'approved-v1');
  await fs.mkdir(path.join(artifactRoot, 'segments'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(artifactRoot, 'segments', '00000.m4s'), 'one'),
    fs.writeFile(path.join(artifactRoot, 'segments', '00001.m4s'), 'two'),
    fs.writeFile(path.join(artifactRoot, 'segments', '00002.m4s'), 'three'),
  ]);
  await fs.writeFile(path.join(artifactRoot, 'artifact.json'), `${JSON.stringify(metadata(), null, 2)}\n`);
  return { mediaRoot, artifactRoot };
}
