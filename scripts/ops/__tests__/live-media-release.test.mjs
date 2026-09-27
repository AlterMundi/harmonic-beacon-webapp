import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('fixed media delivery preserves configuration and recovers interrupted create safely', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./live-media-release_test.py', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});
