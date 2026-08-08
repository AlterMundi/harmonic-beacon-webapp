import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('writes a non-secret inventory readable by the unprivileged origin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-build-artifact-'));
  const segments = path.join(root, 'segments');
  const derivative = path.join(root, 'approved.m4a');
  await fs.mkdir(segments);
  await Promise.all([
    fs.writeFile(path.join(segments, 'init.mp4'), 'init'),
    fs.writeFile(path.join(segments, '00000.m4s'), 'one'),
    fs.writeFile(derivative, 'derivative'),
    fs.writeFile(path.join(root, 'package.m3u8'), [
      '#EXTM3U',
      '#EXT-X-MAP:URI="segments/init.mp4"',
      '#EXTINF:6.000000,',
      '00000.m4s',
      '',
    ].join('\n')),
  ]);

  const result = spawnSync(process.execPath, [
    new URL('../scripts/build-artifact.mjs', import.meta.url).pathname,
    '--artifact-root', root,
    '--artifact-id', 'approved-readable',
    '--derivative', derivative,
    '--master-sha256', 'a'.repeat(64),
    '--epoch-utc', '2026-08-06T00:00:00.000Z',
    '--approved-at', '2026-08-06T18:07:40.000Z',
    '--review-record', 'approved fixture',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const inventory = path.join(root, 'artifact.json');
  assert.equal((await fs.stat(inventory)).mode & 0o777, 0o644);
  assert.equal(JSON.parse(await fs.readFile(inventory, 'utf8')).artifactId, 'approved-readable');
});
