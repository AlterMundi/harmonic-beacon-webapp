import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateCodeowners } from '../validate-codeowners.mjs';

test('the checked-in ownership contract is structurally valid', () => {
  const source = readFileSync(new URL('../../../.github/CODEOWNERS', import.meta.url), 'utf8');
  assert.ok(validateCodeowners(source).rules > 0);
});

test('owners are validated structurally without a permanent person allowlist', () => {
  assert.deepEqual(validateCodeowners([
    '/.github/CODEOWNERS @future-maintainer',
    '/.github/workflows/ @example-org/delivery_team release@example.org',
    '',
  ].join('\n')), { rules: 2 });
});

test('invalid patterns, missing owners, invalid owners and duplicates fail closed', () => {
  for (const source of [
    'relative/path @owner\n',
    '/valid/path\n',
    '/valid/path owner\n',
    '/valid/path @owner\n/valid/path @other\n',
    '/../escape @owner\n',
    '/bad//path @owner\n',
  ]) assert.throws(() => validateCodeowners(source), /CODEOWNERS/u, source);
});

test('empty, oversized and excessive contracts fail closed', () => {
  assert.throws(() => validateCodeowners('# comments only\n'), /at least one/u);
  assert.throws(() => validateCodeowners(Buffer.from([0xc3, 0x28])), /UTF-8/u);
  assert.throws(() => validateCodeowners(`/${'a'.repeat(1100)} @owner\n`), /oversized/u);
  const excessive = Array.from({ length: 513 }, (_, index) => `/path-${index} @owner`).join('\n');
  assert.throws(() => validateCodeowners(excessive), /too many/u);
});
