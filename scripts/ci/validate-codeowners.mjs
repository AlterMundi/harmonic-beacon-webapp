#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 65536;
const MAX_RULES = 512;
const MAX_LINE_BYTES = 1024;
const PATTERN = /^\/(?:[A-Za-z0-9._*?-]+\/?)+$/u;
const HANDLE = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9_-]{0,98}[A-Za-z0-9])?)?$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function fail(line, message) {
  const location = line === null ? '' : ` line ${line}`;
  throw new Error(`CODEOWNERS${location}: ${message}`);
}

export function validateCodeowners(input) {
  const bytes = Buffer.isBuffer(input) ? input : typeof input === 'string' ? Buffer.from(input) : null;
  if (!bytes || bytes.length > MAX_BYTES) {
    fail(null, 'input is not bounded UTF-8 text');
  }
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(null, 'input is not bounded UTF-8 text'); }
  if (source.includes('\0')) fail(null, 'input is not bounded UTF-8 text');
  const patterns = new Set();
  let rules = 0;
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = index + 1;
    if (Buffer.byteLength(raw) > MAX_LINE_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) {
      fail(line, 'line is oversized or contains control characters');
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [pattern, ...owners] = trimmed.split(/\s+/u);
    if (!PATTERN.test(pattern) || pattern.includes('//') || pattern.split('/').includes('..')) {
      fail(line, `invalid repository-anchored pattern: ${pattern}`);
    }
    if (patterns.has(pattern)) fail(line, `duplicate pattern: ${pattern}`);
    if (!owners.length || owners.some(owner => !HANDLE.test(owner) && !EMAIL.test(owner))) {
      fail(line, 'each rule requires one or more valid GitHub handles, teams, or email owners');
    }
    patterns.add(pattern);
    rules += 1;
    if (rules > MAX_RULES) fail(line, 'too many ownership rules');
  }
  if (!rules) fail(null, 'at least one ownership rule is required');
  return { rules };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Usage: validate-codeowners.mjs PATH');
  const path = resolve(argv[0]);
  const result = validateCodeowners(readFileSync(path));
  console.log(JSON.stringify({ valid: true, rules: result.rules }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
