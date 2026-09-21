import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const hook = read('.husky/pre-commit');
const packageJson = JSON.parse(read('package.json'));
const ciWorkflow = read('.github/workflows/ci.yml');
const e2eWorkflow = read('.github/workflows/e2e.yml');
const audioWorkflow = read('.github/workflows/audio-boundary.yml');
const deployWorkflow = read('.github/workflows/deploy.yml');
const candidateWorkflow = read('.github/workflows/oci-candidate.yml');

test('pre-commit runs only staged lint and never the full test suite', () => {
  const commands = hook
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(commands, ['npx lint-staged']);
  assert.doesNotMatch(hook, /\b(?:vitest|npm\s+(?:run\s+)?test)\b/u);
});

test('full Vitest remains explicit locally and required in hosted CI', () => {
  assert.equal(packageJson.scripts.test, 'vitest run');
  assert.equal(packageJson.scripts['test:coverage'], 'vitest run --coverage');
  assert.match(ciWorkflow, /^\s*- run: npm run test:coverage$/mu);
  assert.doesNotMatch(ciWorkflow, /continue-on-error:\s*true[\s\S]{0,200}npm run test:coverage/u);
});

test('commerce verifier runs inside the mapped test context', () => {
  assert.match(ciWorkflow, /^\s*- run: npm run contract:commerce:verify$/mu);
});

test('CI is the sole PR orchestrator for the reusable E2E matrix', () => {
  assert.match(ciWorkflow, /uses: \.\/\.github\/workflows\/e2e\.yml/u);
  assert.match(e2eWorkflow, /^ {2}workflow_call:/m);
  assert.doesNotMatch(e2eWorkflow, /^ {2}pull_request:/m);
  assert.doesNotMatch(e2eWorkflow, /github\.event\.pull_request\.draft/u);
});

test('the distinct audio label boundary remains a PR check', () => {
  assert.match(audioWorkflow, /^ {2}pull_request:/m);
  assert.match(audioWorkflow, /Require the audio-touching label/u);
  assert.match(ciWorkflow, /^  frozen-audio-paths:/m);
});

test('governance-only impact uses local ownership and focused control-plane checks', () => {
  assert.match(ciWorkflow, /node scripts\/ci\/validate-codeowners\.mjs \.github\/CODEOWNERS/u);
  assert.match(ciWorkflow, /gh api --method GET[\s\S]*codeowners\/errors\?ref=\$HEAD_SHA[\s\S]*\.errors \| type == "array" and length == 0/u);
  assert.match(ciWorkflow, /governance_only: \$\{\{ steps\.classify\.outputs\.governance_only \}\}/u);
  assert.match(ciWorkflow, /ownership_changed: \$\{\{ steps\.classify\.outputs\.ownership_changed \}\}/u);
  assert.match(ciWorkflow, /if: steps\.classify\.outputs\.ownership_changed == 'true'\n\s+run: node scripts\/ci\/validate-codeowners/u);
  assert.match(ciWorkflow, /if: steps\.classify\.outputs\.governance_only == 'true'[\s\S]*scripts\/ci\/__tests__\/validate-codeowners\.test\.mjs/u);
  assert.match(ciWorkflow, /if: steps\.classify\.outputs\.governance_only != 'true'\n\s+run: npm ci/u);
  assert.doesNotMatch(e2eWorkflow, /^ {2}pull_request:/m);
});

test('candidate-executing pull request workflows grant read-only contents explicitly', () => {
  for (const [path, workflow] of [
    ['ci.yml', ciWorkflow],
    ['e2e.yml', e2eWorkflow],
    ['audio-boundary.yml', audioWorkflow],
  ]) {
    assert.match(workflow, /^permissions:\n(?:  [a-z-]+: read\n)+/m, path);
    assert.match(workflow, /^  contents: read$/m, path);
    assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/m, path);
  }
});

test('release qualification retains the protected full Vitest gate and immutable OCI qualification', () => {
  assert.match(ciWorkflow, /^\s*- run: npm run test:coverage$/mu);
  assert.match(candidateWorkflow, /node scripts\/ci\/qualify-oci\.mjs[\s\S]*--no-build/u);
  assert.match(deployWorkflow, /safety-hold/u);
});

test('legacy release fails closed during the security hold', () => {
  assert.match(deployWorkflow, /safety-hold/u);
  assert.match(deployWorkflow, /exit 1/u);
  assert.doesNotMatch(deployWorkflow, /sudo|self-hosted/u);
});
