#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { validateReceipt } from '../../ops/listener-delivery/v1/libexec/receipt.mjs';

const fail = (message) => {
  process.stderr.write(`Listen delivery receipt: ${message}\n`);
  process.exit(2);
};
const sha256 = /^[0-9a-f]{64}$/;
const [command, file, expectedAuthorityHash] = process.argv.slice(2);
if (!['validate', 'write'].includes(command) || !file || !sha256.test(expectedAuthorityHash ?? '')) {
  fail('usage: receipt.mjs validate|write FILE EXPECTED_AUTHORITY_SHA256');
}
let value;
try {
  value = JSON.parse(command === 'write' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8'));
  validateReceipt(value, expectedAuthorityHash);
} catch (error) {
  fail(error instanceof Error ? error.message.replace(/^Listen delivery receipt: /, '') : 'receipt is invalid');
}
if (command === 'write') {
  try {
    const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    fail(error?.code === 'EEXIST' ? 'receipt CAS conflict' : 'receipt write failed');
  }
}
process.stdout.write('Listen delivery receipt is valid.\n');
