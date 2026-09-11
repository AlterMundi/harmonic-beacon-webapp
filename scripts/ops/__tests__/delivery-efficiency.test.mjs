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

test('release qualification retains the full Vitest gate', () => {
  assert.match(deployWorkflow, /^\s+npm test$/mu);
});

test('legacy release fails closed during the security hold', () => {
  assert.match(deployWorkflow, /safety-hold/u);
  assert.match(deployWorkflow, /exit 1/u);
  assert.doesNotMatch(deployWorkflow, /sudo|self-hosted/u);
});
