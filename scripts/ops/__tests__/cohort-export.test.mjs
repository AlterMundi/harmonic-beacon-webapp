import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
test('private cohort exporter validates synthetic snapshots without remote access', () => {
  // This profile integrates after the exporter; deleting only one file is an error.
  const script = existsSync(`${root}scripts/export-live-cohort.py`);
  const suite = existsSync(`${root}scripts/test_export_live_cohort.py`);
  assert.equal(script, suite, 'exporter and its test suite must remain paired');
  if (!script) return; // A branch without the feature has no exporter to exercise.
  execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_export_live_cohort.py'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
});
