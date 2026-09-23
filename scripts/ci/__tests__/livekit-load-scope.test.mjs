import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiresLiveKitLoad, selectFromRefs } from '../livekit-load-scope.mjs';

test('staff navigation and bridge changes retain browser tests but need no capacity exercise', () => {
  assert.equal(requiresLiveKitLoad(['src/app/layout.tsx', 'src/lib/brand/account-navigation-state.ts',
    'deploy/hb-app-bridge-root', 'docs/ops/STAFF_MODE_ACCESS_20260923.md']), false);
});
test('media, unknown, shared config and selector changes retain load coverage', () => {
  for (const file of ['src/lib/room-audio.ts', 'package-lock.json', 'Dockerfile',
    'scripts/ci/livekit-load-scope.mjs', '.github/workflows/e2e.yml', 'unknown']) {
    assert.equal(requiresLiveKitLoad(['src/app/layout.tsx', file]), true, file);
  }
  assert.equal(requiresLiveKitLoad([]), true);
});
test('missing refs, deleted paths and unavailable comparison fail to full coverage', () => {
  assert.equal(selectFromRefs('', 'a'.repeat(40)), true);
  assert.equal(selectFromRefs('0'.repeat(40), 'a'.repeat(40)), true);
  assert.equal(selectFromRefs('a'.repeat(40), 'b'.repeat(40), () => { throw Error('unavailable'); }), true);
  assert.equal(selectFromRefs('a'.repeat(40), 'b'.repeat(40), () => 'src/lib/room-audio.ts\0'), true);
  assert.equal(selectFromRefs('a'.repeat(40), 'b'.repeat(40), () => 'src/app/layout.tsx\0'), false);
});
test('only load tooling and capacity steps are conditional; browser gates remain', () => {
  const workflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
  for (const title of ['Run small dual-LiveKit load profile', 'Qualify bounded Stage-only 6/9/12 paired audio and video']) {
    assert.ok(workflow.includes(`- name: ${title}\n        if: steps.load-scope.outputs.required == 'true'`));
  }
  assert.ok(workflow.includes('- name: Run Chromium and Android gates\n        run:'));
  assert.ok(workflow.includes('- name: Run isolated Chromium room-exit helper regressions\n        run:'));
});
