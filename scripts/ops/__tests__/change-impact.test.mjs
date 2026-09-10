import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChanges } from '../../ci/change-impact.mjs';

const checkNames = (report) => report.requiredChecks.map(({ check }) => check);

test('documentation-only changes do not request application builds', () => {
  const report = classifyChanges(['docs/ops/example.md']);
  assert.deepEqual(report.categories, ['documentation']);
  assert.deepEqual(checkNames(report), ['diff-check']);
});

test('skill source changes require generated distribution and tooling checks', () => {
  const report = classifyChanges(['.agents/skills/review-agent/source/body.md']);
  assert.deepEqual(report.categories, ['agent-skills', 'documentation']);
  assert.deepEqual(checkNames(report), ['diff-check', 'agent-skill-distributions']);
});

test('audio changes retain the full frozen boundary', () => {
  const report = classifyChanges(['src/context/AudioContext.tsx']);
  assert.deepEqual(checkNames(report), ['diff-check', 'lint-and-build', 'test', 'e2e', 'frozen-audio-paths']);
  assert.deepEqual(report.details.frozenAudioPaths, ['src/context/AudioContext.tsx']);
});

test('analytics-only changes do not request Live browser gates', () => {
  const report = classifyChanges(['services/analytics/src/worker.mjs']);
  assert.deepEqual(report.categories, ['analytics']);
  assert.deepEqual(checkNames(report), ['diff-check', 'analytics']);
});

test('unknown paths fail conservative', () => {
  const report = classifyChanges(['mystery/runtime.xyz']);
  assert.deepEqual(report.categories, ['unclassified']);
  assert.deepEqual(checkNames(report), ['diff-check', 'lint-and-build', 'test', 'e2e']);
  assert.deepEqual(report.details.unclassifiedPaths, ['mystery/runtime.xyz']);
});

test('deployment changes require exact release qualification', () => {
  const report = classifyChanges(['deploy/hb-deploy-root']);
  assert.deepEqual(checkNames(report), ['diff-check', 'lint-and-build', 'test', 'e2e', 'workflow-review', 'release-qualification']);
});
