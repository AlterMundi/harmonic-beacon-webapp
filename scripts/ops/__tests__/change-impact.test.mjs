import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChanges } from '../../ci/change-impact.mjs';

const checkNames = (report) => report.requiredChecks.map(({ check }) => check);
const contexts = (report) => report.requiredContexts;

const FULL_DELIVERY_CONTEXTS = [
  'diff-check',
  'lint-and-build',
  'test',
  'analytics',
  'e2e',
  'account',
  'frozen-audio-paths',
];

test('documentation-only changes do not request application builds', () => {
  for (const path of [
    'docs/ops/example.md',
    'services/tapestry/README.md',
    'deploy/README.md',
    'e2e/README.md',
  ]) {
    const report = classifyChanges([path]);
    assert.deepEqual(report.categories, ['documentation'], path);
    assert.deepEqual(checkNames(report), ['diff-check'], path);
    assert.deepEqual(contexts(report), ['diff-check'], path);
  }
});

test('hashed commerce Markdown retains the emitted contract verifier context without browser gates', () => {
  const report = classifyChanges(['contracts/commerce-entitlement/v1/README.md']);
  assert.deepEqual(report.categories, ['commerce', 'documentation']);
  assert.deepEqual(contexts(report), ['diff-check', 'test']);
});

test('skill source changes require generated distribution and tooling checks', () => {
  const report = classifyChanges(['.agents/skills/review-agent/source/body.md']);
  assert.deepEqual(report.categories, ['agent-skills', 'documentation']);
  assert.deepEqual(checkNames(report), ['diff-check', 'agent-skill-distributions']);
  assert.deepEqual(contexts(report), ['diff-check', 'lint-and-build']);
});

test('audio changes retain the full frozen boundary and both E2E jobs', () => {
  const report = classifyChanges(['src/context/AudioContext.tsx']);
  assert.deepEqual(checkNames(report), ['diff-check', 'lint-and-build', 'test', 'e2e', 'frozen-audio-paths']);
  assert.deepEqual(contexts(report), ['diff-check', 'lint-and-build', 'test', 'e2e', 'account', 'frozen-audio-paths']);
  assert.deepEqual(report.details.frozenAudioPaths, ['src/context/AudioContext.tsx']);
});

test('analytics-only changes do not request Live browser gates', () => {
  const report = classifyChanges(['services/analytics/src/worker.mjs']);
  assert.deepEqual(report.categories, ['analytics']);
  assert.deepEqual(checkNames(report), ['diff-check', 'analytics']);
  assert.deepEqual(contexts(report), ['diff-check', 'analytics']);
});

test('unknown paths fail conservative', () => {
  const report = classifyChanges(['mystery/runtime.xyz']);
  assert.deepEqual(report.categories, ['unclassified']);
  assert.deepEqual(checkNames(report), ['diff-check', 'lint-and-build', 'test', 'e2e']);
  assert.deepEqual(contexts(report), ['diff-check', 'lint-and-build', 'test', 'e2e', 'account']);
  assert.deepEqual(report.details.unclassifiedPaths, ['mystery/runtime.xyz']);
});

test('workflow, evaluator, CODEOWNERS and deploy surfaces request full emitted qualification', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    'scripts/ci/required-checks.mjs',
    'deploy/hb-deploy-root',
    'deploy/beacon-runner.sudoers',
    'docker-compose.yml',
    'Dockerfile',
    'scripts/live-production/activate-account.sh',
  ]) {
    assert.deepEqual(contexts(classifyChanges([path])), FULL_DELIVERY_CONTEXTS, path);
  }
});

test('human review requirements are not misrepresented as emitted contexts', () => {
  const report = classifyChanges(['deploy/hb-deploy-root']);
  assert.deepEqual(checkNames(report), [
    'diff-check',
    'lint-and-build',
    'test',
    'analytics',
    'e2e',
    'frozen-audio-paths',
    'workflow-review',
    'release-qualification',
  ]);
  assert.ok(!contexts(report).includes('workflow-review'));
  assert.ok(!contexts(report).includes('release-qualification'));
});
