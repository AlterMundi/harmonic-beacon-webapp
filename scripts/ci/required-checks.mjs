#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from './change-impact.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PENDING_STATUSES = new Set(['queued', 'in_progress', 'pending', 'requested', 'waiting']);
const MAX_REASONS = 20;

function fail(requiredContexts, ...reasons) {
  const bounded = reasons.slice(0, MAX_REASONS);
  return {
    schemaVersion: 1,
    state: 'failure',
    description: `delivery gate failed: ${bounded[0] ?? 'invalid-input'}`.slice(0, 140),
    requiredContexts,
    reasons: bounded,
  };
}

function validateInput(input) {
  const integerFields = ['prNumber', 'currentPrNumber'];
  for (const field of integerFields) {
    if (!Number.isSafeInteger(input[field]) || input[field] <= 0) throw new Error(`${field} must be a positive integer`);
  }
  for (const field of ['protectedPrCount', 'reportedChangedFileCount', 'listedChangedFileCount']) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) throw new Error(`${field} must be a non-negative integer`);
  }
  for (const field of ['eventHeadSha', 'eventBaseSha', 'currentHeadSha', 'currentBaseSha']) {
    if (!SHA_PATTERN.test(input[field] ?? '')) throw new Error(`${field} must be a full lowercase commit SHA`);
  }
  for (const field of ['expectedBaseRef', 'currentPrState', 'currentBaseRef', 'evidenceNotBefore']) {
    if (typeof input[field] !== 'string' || input[field].length === 0 || input[field].length > 100) {
      throw new Error(`${field} must be a bounded non-empty string`);
    }
  }
  if (!Number.isFinite(Date.parse(input.evidenceNotBefore))) throw new Error('evidenceNotBefore must be an ISO timestamp');
  if (typeof input.baseIsAncestor !== 'boolean' || typeof input.deadlineExpired !== 'boolean') {
    throw new Error('baseIsAncestor and deadlineExpired must be booleans');
  }
  if (!Array.isArray(input.changedFiles) || !input.changedFiles.every((path) => typeof path === 'string' && path.length <= 4096)) {
    throw new Error('changedFiles must be an array of bounded strings');
  }
  if (!Array.isArray(input.checkRuns) || input.checkRuns.length > 10_000) throw new Error('checkRuns must be a bounded array');
}

function runRank(run, index) {
  const id = Number(run.id);
  if (Number.isSafeInteger(id) && id >= 0) return id;
  const timestamp = Date.parse(run.completed_at ?? run.started_at ?? run.created_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : index;
}

function latestExactRuns(checkRuns, headSha, evidenceNotBefore) {
  const cutoff = Date.parse(evidenceNotBefore);
  const latest = new Map();
  checkRuns.forEach((run, index) => {
    if (run?.head_sha !== headSha || typeof run?.name !== 'string') return;
    const timestamps = [run.created_at, run.started_at]
      .map((value) => Date.parse(value ?? ''))
      .filter(Number.isFinite);
    const timestamp = timestamps.length ? Math.min(...timestamps) : Number.NaN;
    if (run.status === 'completed' && run.conclusion === 'success'
        && (!Number.isFinite(timestamp) || timestamp < cutoff)) return;
    const rank = runRank(run, index);
    const prior = latest.get(run.name);
    if (!prior || rank >= prior.rank) latest.set(run.name, { run, rank });
  });
  return new Map([...latest].map(([name, { run }]) => [name, run]));
}

export function evaluateRequiredChecks(input) {
  validateInput(input);
  const requiredContexts = classifyChanges(input.changedFiles).requiredContexts;

  if (input.prNumber !== input.currentPrNumber) return fail(requiredContexts, 'wrong-pr');
  if (input.eventHeadSha !== input.currentHeadSha) return fail(requiredContexts, 'obsolete-head');
  if (input.protectedPrCount !== 1) return fail(requiredContexts, 'ambiguous-head');
  if (input.reportedChangedFileCount !== input.listedChangedFileCount) return fail(requiredContexts, 'incomplete-files');
  if (input.currentPrState !== 'open') return fail(requiredContexts, 'pr-not-open');
  if (input.currentBaseRef !== input.expectedBaseRef) return fail(requiredContexts, 'unexpected-base');
  if (!input.baseIsAncestor) return fail(requiredContexts, 'obsolete-base');

  const latest = latestExactRuns(input.checkRuns, input.eventHeadSha, input.evidenceNotBefore);
  const missing = [];
  const pending = [];
  const failed = [];

  for (const context of requiredContexts) {
    const run = latest.get(context);
    if (!run) {
      missing.push(`missing:${context}`);
      continue;
    }
    if (PENDING_STATUSES.has(run.status)) {
      pending.push(`pending:${context}:${run.status}`);
      continue;
    }
    if (run.status !== 'completed') {
      failed.push(`status:${context}:${String(run.status ?? 'missing')}`);
      continue;
    }
    if (run.conclusion !== 'success') failed.push(`conclusion:${context}:${String(run.conclusion ?? 'missing')}`);
  }

  if (failed.length) return fail(requiredContexts, ...failed, ...pending, ...missing);
  if (pending.length) {
    const reasons = [...pending, ...missing].slice(0, MAX_REASONS);
    return {
      schemaVersion: 1,
      state: 'pending',
      description: `waiting for ${reasons.length} required check${reasons.length === 1 ? '' : 's'}`,
      requiredContexts,
      reasons,
    };
  }
  if (missing.length) {
    if (input.deadlineExpired) return fail(requiredContexts, ...missing);
    return {
      schemaVersion: 1,
      state: 'pending',
      description: `waiting for ${missing.length} required check${missing.length === 1 ? '' : 's'}`,
      requiredContexts,
      reasons: missing.slice(0, MAX_REASONS),
    };
  }

  return {
    schemaVersion: 1,
    state: 'success',
    description: `all ${requiredContexts.length} required checks succeeded`,
    requiredContexts,
    reasons: [],
  };
}

function parseArgs(argv) {
  const options = { input: '-' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index] ?? '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown required-checks argument: ${arg}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/ci/required-checks.mjs [--input PATH|-]');
    return 0;
  }
  const source = options.input === '-' ? readFileSync(0, 'utf8') : readFileSync(options.input, 'utf8');
  console.log(JSON.stringify(evaluateRequiredChecks(JSON.parse(source))));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`required-checks: ${error.message}`);
    process.exitCode = 1;
  }
}
