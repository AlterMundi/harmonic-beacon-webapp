import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateCodeowners } from '../validate-codeowners.mjs';

test('the checked-in ownership contract is bounded valid UTF-8', () => {
  const source = readFileSync(new URL('../../../.github/CODEOWNERS', import.meta.url), 'utf8');
  assert.ok(validateCodeowners(source).bytes > 0);
});

test('GitHub-supported forms remain the native exact-head validator responsibility', () => {
  const source = [
    '* @default-owner',
    '*.js @javascript-team # inline comment',
    'relative/path @owner',
    'relative/path @replacement-owner',
    '/docs/generated/',
    '',
  ].join('\n');
  assert.equal(validateCodeowners(source).bytes, Buffer.byteLength(source));
});

test('invalid UTF-8, NUL and files over GitHub\'s size limit fail locally', () => {
  assert.throws(() => validateCodeowners(Buffer.from([0xc3, 0x28])), /UTF-8/u);
  assert.throws(() => validateCodeowners(Buffer.from('valid\0invalid')), /NUL/u);
  assert.throws(() => validateCodeowners(Buffer.alloc(3 * 1024 * 1024 + 1, 0x61)), /3 MiB/u);
  assert.doesNotThrow(() => validateCodeowners(Buffer.alloc(3 * 1024 * 1024, 0x61)));
});
