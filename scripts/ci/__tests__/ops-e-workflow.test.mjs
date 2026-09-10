import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const promote = readFileSync('.github/workflows/oci-promote.yml', 'utf8');

test('CI derives its service test jobs from the executable impact classifier', () => {
  assert.match(ci, /^  impact:\n/mu);
  assert.match(ci, /change-impact --base "\$base" --head "\$head" --json/u);
  assert.match(ci, /if: needs\.impact\.outputs\.app == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.analytics == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.tapestry == 'true'/u);
  assert.match(ci, /\.deployment\.servicesToReplace \| index\("playlist-bot"\)/u);
});

test('required CI aggregator rejects a skipped selected job', () => {
  assert.match(ci, /^  required-impact-checks:\n/mu);
  assert.match(ci, /if: always\(\)/u);
  assert.match(ci, /selected required job did not succeed/u);
});

test('promotion records the root-owned deterministic impact plan before mutation', () => {
  assert.match(promote, /ref: \$\{\{ github\.sha \}\}\n          fetch-depth: 0/u);
  const prepare = promote.indexOf('artifact-prepare');
  const impact = promote.indexOf('artifact-impact');
  const preflight = promote.indexOf('artifact-preflight');
  assert.ok(prepare >= 0 && impact > prepare && preflight > impact);
  assert.match(promote, /"\$SOURCE_SHA" "\$SOURCE_TREE" "\$CANDIDATE_RUN_ID"/u);
});

test('promotion checks DB and LiveKit continuity before any selected replacement', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const replace = helper.slice(helper.indexOf('artifact_replace()'), helper.indexOf('\nverify_container_image()'));
  assert.match(replace, /release-quiesce-preflight\.ts/u);
  assert.match(helper, /candidateMigrationVerified/u);
});
