#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub ignores CODEOWNERS files larger than 3 MiB. Pattern and owner semantics
// belong to GitHub's exact-head errors API, not a second local grammar.
const MAX_BYTES = 3 * 1024 * 1024;

function fail(message) {
  throw new Error(`CODEOWNERS: ${message}`);
}

export function validateCodeowners(input) {
  const bytes = Buffer.isBuffer(input) ? input : typeof input === 'string' ? Buffer.from(input) : null;
  if (!bytes || bytes.length > MAX_BYTES) {
    fail('input exceeds GitHub\'s 3 MiB limit or is not bytes/text');
  }
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('input is not valid UTF-8'); }
  if (source.includes('\0')) fail('input contains NUL bytes');
  return { bytes: bytes.length, lines: source === '' ? 0 : source.split(/\n/u).length };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Usage: validate-codeowners.mjs PATH');
  const path = resolve(argv[0]);
  const result = validateCodeowners(readFileSync(path));
  console.log(JSON.stringify({ valid: true, ...result }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
