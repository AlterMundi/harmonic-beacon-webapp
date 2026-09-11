import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

function fail(message) { throw new Error(message); }

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicWriteBytes(path, bytes, options = {}) {
  const parent = dirname(path);
  const temp = join(parent, `.${path.split('/').at(-1)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  let renamed = false;
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    if (options.failpoint === 'before-rename') fail('injected crash before rename');
    renameSync(temp, path);
    renamed = true;
    if (options.failpoint === 'after-rename') fail('injected crash after rename');
    syncDirectory(parent);
  } catch (error) {
    try { closeSync(fd); } catch {}
    if (!renamed) {
      try { unlinkSync(temp); } catch {}
    }
    throw error;
  }
}

export function atomicWriteJson(path, value, options = {}) {
  atomicWriteBytes(path, `${JSON.stringify(value)}\n`, options);
}

export function writeContentAddressed(directory, body) {
  const sha256 = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const path = join(directory, `${sha256.slice(7)}.json`);
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) {
      fail('occupied content-addressed path is unsafe');
    }
    if (readFileSync(path, 'utf8') !== body) fail('occupied content-addressed path differs from expected bytes');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    atomicWriteBytes(path, body);
  }
  return { sha256, path };
}

export function readJsonFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 1024 * 1024) {
    fail('unsafe durable JSON file');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function compareAndSwapJournal(path, expected, additions, options = {}) {
  const current = readJsonFile(path);
  if (current.phase !== expected.phase) fail(`journal CAS phase conflict: expected ${expected.phase}, observed ${current.phase}`);
  if (current.generation !== expected.generation) fail(`journal CAS generation conflict: expected ${expected.generation}, observed ${current.generation}`);
  const next = { ...current, ...additions, generation: current.generation + 1 };
  atomicWriteJson(path, next, options);
  return next;
}

export function exactIdentity(expected, observed, label = 'identity') {
  if (JSON.stringify(expected) !== JSON.stringify(observed)) fail(`${label} identity conflict`);
  return expected;
}
