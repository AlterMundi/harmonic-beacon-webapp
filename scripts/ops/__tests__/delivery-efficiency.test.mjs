import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const hook = read('.husky/pre-commit');
const packageJson = JSON.parse(read('package.json'));
const ciWorkflow = read('.github/workflows/ci.yml');
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

test('release qualification retains the full Vitest gate', () => {
  assert.match(deployWorkflow, /^\s+npm test$/mu);
});
