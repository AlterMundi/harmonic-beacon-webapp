#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TRANSACTION_SCHEMA = 'listen-delivery-transaction.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const BINDING_KEYS = [
  'checkpoint_mode', 'ci_run_attempt', 'ci_run_id', 'configuration_sha256', 'delivery_run_attempt',
  'delivery_run_id', 'operation', 'source_sha', 'target',
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('transaction directory is unsafe');
}
function writeExclusive(file, value) {
  const bytes = `${canonical(value)}\n`;
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, bytes, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fsyncDirectory(path.dirname(file));
  return bytes;
}
function readJson(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || before.size < 2 || before.size > 65_536) throw new Error('transaction state file is unsafe');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid || opened.nlink !== 1 || opened.size !== before.size) throw new Error('transaction state changed while opening');
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } finally { fs.closeSync(descriptor); }
}
function validateBinding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('transaction binding is invalid');
  const binding = { ...raw, checkpoint_mode: raw.checkpoint_mode ?? 'deliver' };
  if (canonical(Object.keys(binding).sort()) !== canonical(BINDING_KEYS)) throw new Error('transaction binding fields are invalid');
  if (!['staging', 'production'].includes(binding.target)) throw new Error('transaction target is invalid');
  if (!['deploy', 'rollback'].includes(binding.operation)) throw new Error('transaction operation is invalid');
  if (!['deliver', 'interrupt'].includes(binding.checkpoint_mode) || (binding.target === 'production' && binding.checkpoint_mode !== 'deliver') || (binding.operation !== 'deploy' && binding.checkpoint_mode !== 'deliver')) throw new Error('transaction checkpoint is invalid');
  if (!SHA40.test(binding.source_sha) || !SHA256.test(binding.configuration_sha256)) throw new Error('transaction digest is invalid');
  for (const key of ['delivery_run_id', 'delivery_run_attempt', 'ci_run_id', 'ci_run_attempt']) if (!POSITIVE.test(binding[key])) throw new Error('transaction run identity is invalid');
  return binding;
}
export function transactionKey(binding) {
  return createHash('sha256').update(canonical(validateBinding(binding))).digest('hex');
}
function pathsFor(root, binding, transactionId = transactionKey(binding)) {
  const slot = `${binding.target}-${binding.operation}-${binding.delivery_run_id}-${binding.delivery_run_attempt}`;
  return {
    active: path.join(root, `active-${binding.target}.json`),
    index: path.join(root, 'identities', `${slot}.json`),
    receipt: path.join(root, 'receipts', `${transactionId}.json`),
    journal: path.join(root, 'journals', transactionId),
  };
}
function initialize(root) {
  ensureDirectory(root);
  for (const name of ['identities', 'receipts', 'journals']) ensureDirectory(path.join(root, name));
}
function latestJournal(journalDirectory) {
  const names = fs.readdirSync(journalDirectory);
  if (!names.length || names.some((name) => !/^(0|[1-9][0-9]*)\.json$/.test(name))) throw new Error('transaction journal inventory is invalid');
  const revisions = names.map((name) => Number(name.slice(0, -5))).sort((left, right) => left - right);
  if (revisions.some((revision, index) => revision !== index)) throw new Error('transaction journal revisions are not contiguous');
  const current = readJson(path.join(journalDirectory, `${revisions.at(-1)}.json`));
  if (current.revision !== revisions.at(-1)) throw new Error('transaction journal revision is invalid');
  return current;
}

export function readCommittedReceipt(root, rawBinding) {
  const binding = validateBinding(rawBinding);
  const transactionId = transactionKey(binding);
  const files = pathsFor(root, binding, transactionId);
  if (!fs.existsSync(files.index)) {
    if (fs.existsSync(files.receipt)) throw new Error('orphan transaction receipt');
    return null;
  }
  const identity = readJson(files.index);
  if (identity.transaction_id !== transactionId || canonical(identity.binding) !== canonical(binding)) throw new Error('transaction identity conflict');
  return fs.existsSync(files.receipt) ? readJson(files.receipt) : null;
}

export function beginOrResume(root, rawBinding) {
  const binding = validateBinding(rawBinding);
  initialize(root);
  const transactionId = transactionKey(binding);
  const files = pathsFor(root, binding, transactionId);
  if (fs.existsSync(files.index)) {
    const identity = readJson(files.index);
    if (identity.transaction_id !== transactionId || canonical(identity.binding) !== canonical(binding)) throw new Error('transaction identity conflict');
    if (fs.existsSync(files.receipt)) return { kind: 'receipt', value: readJson(files.receipt) };
  } else {
    writeExclusive(files.index, { schema_version: 'listen-delivery-identity.v1', transaction_id: transactionId, binding });
  }
  if (fs.existsSync(files.active)) {
    const active = readJson(files.active);
    if (active.transaction_id === transactionId && canonical(active.binding) === canonical(binding)) return { kind: 'journal', value: latestJournal(files.journal) };
    const oldReceipt = path.join(root, 'receipts', `${active.transaction_id}.json`);
    if (!fs.existsSync(oldReceipt)) throw new Error('active transaction conflict');
    readJson(oldReceipt);
    fs.unlinkSync(files.active);
    fsyncDirectory(root);
  }
  ensureDirectory(files.journal);
  const initialFile = path.join(files.journal, '0.json');
  const journal = { schema_version: TRANSACTION_SCHEMA, transaction_id: transactionId, binding, phase: 'admitted', revision: 0 };
  if (fs.existsSync(initialFile)) {
    if (canonical(readJson(initialFile)) !== canonical(journal)) throw new Error('transaction journal conflict');
  } else writeExclusive(initialFile, journal);
  writeExclusive(files.active, { schema_version: 'listen-delivery-active.v1', transaction_id: transactionId, binding });
  return { kind: 'journal', value: journal };
}

export function advancePhase(root, journal, expectedPhase, nextPhase, fields = {}) {
  const files = pathsFor(root, journal.binding, journal.transaction_id);
  const active = readJson(files.active);
  if (active.transaction_id !== journal.transaction_id || canonical(active.binding) !== canonical(journal.binding)) throw new Error('journal phase CAS conflict');
  const current = latestJournal(files.journal);
  if (current.transaction_id !== journal.transaction_id || current.revision !== journal.revision || current.phase !== expectedPhase) throw new Error('journal phase CAS conflict');
  const next = { ...current, ...fields, phase: nextPhase, revision: current.revision + 1 };
  const nextFile = path.join(files.journal, `${next.revision}.json`);
  try { writeExclusive(nextFile, next); }
  catch (error) {
    if (error?.code !== 'EEXIST' || canonical(readJson(nextFile)) !== canonical(next)) throw new Error('journal phase CAS conflict');
  }
  return next;
}

export function commitReceipt(root, journal, receipt) {
  initialize(root);
  const files = pathsFor(root, journal.binding, journal.transaction_id);
  const value = { ...receipt };
  const bytes = `${canonical(value)}\n`;
  if (fs.existsSync(files.receipt)) {
    if (`${canonical(readJson(files.receipt))}\n` !== bytes) throw new Error('receipt CAS conflict');
    return readJson(files.receipt);
  }
  const active = readJson(files.active);
  const current = latestJournal(files.journal);
  if (active.transaction_id !== journal.transaction_id || current.transaction_id !== journal.transaction_id || current.revision < journal.revision) throw new Error('journal phase CAS conflict');
  writeExclusive(files.receipt, value);
  if (current.phase !== 'receipt_committed') advancePhase(root, current, current.phase, 'receipt_committed', { receipt_sha256: createHash('sha256').update(bytes).digest('hex') });
  return value;
}

export function runFixtureTransaction(root, binding, effect) {
  const resumed = beginOrResume(root, binding);
  if (resumed.kind === 'receipt') return resumed.value;
  let journal = resumed.value;
  if (journal.phase === 'admitted') {
    const effectResult = effect();
    journal = advancePhase(root, journal, 'admitted', 'mutated', { effect_result: effectResult });
  }
  return commitReceipt(root, journal, { schema_version: 'fixture-receipt.v1', transaction_id: journal.transaction_id, outcome: 'succeeded', effect_result: journal.effect_result });
}
