import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('operator candidate admission, provenance and recovery boundaries', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'deploy', '-p', 'test_live_candidate.py'], {
    cwd: root, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
