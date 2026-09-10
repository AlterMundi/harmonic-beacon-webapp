#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from './change-impact.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PENDING_STATUSES = new Set(['queued', 'in_progress', 'pending', 'requested', 'waiting']);
const MAX_REASONS = 20;
const ACTIONS_APP = Object.freeze({ id: 15368, slug: 'github-actions' });
const EXPECTED_WORKFLOWS = Object.freeze({
  'diff-check': { name: 'CI', path: '.github/workflows/ci.yml' },
  'lint-and-build': { name: 'CI', path: '.github/workflows/ci.yml' },
  test: { name: 'CI', path: '.github/workflows/ci.yml' },
  analytics: { name: 'CI', path: '.github/workflows/ci.yml' },
  e2e: { name: 'E2E quality gates', path: '.github/workflows/e2e.yml' },
  account: { name: 'E2E quality gates', path: '.github/workflows/e2e.yml' },
  'frozen-audio-paths': { name: 'Audio boundary', path: '.github/workflows/audio-boundary.yml' },
});

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
  for (const field of ['protectedPrCount', 'reportedChangedFileCount', 'listedChangedFileCount', 'reportedCheckRunCount']) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) throw new Error(`${field} must be a non-negative integer`);
  }
  for (const field of ['eventHeadSha', 'eventBaseSha', 'currentHeadSha', 'currentBaseSha', 'currentMergeSha', 'evaluatorBaseSha']) {
    if (!SHA_PATTERN.test(input[field] ?? '')) throw new Error(`${field} must be a full lowercase commit SHA`);
  }
  for (const field of ['expectedBaseRef', 'currentPrState', 'currentBaseRef', 'evidenceNotBefore']) {
    if (typeof input[field] !== 'string' || input[field].length === 0 || input[field].length > 100) {
      throw new Error(`${field} must be a bounded non-empty string`);
    }
  }
  if (!Number.isFinite(Date.parse(input.evidenceNotBefore))) throw new Error('evidenceNotBefore must be an ISO timestamp');
  if (typeof input.baseIsAncestor !== 'boolean'
      || typeof input.deadlineExpired !== 'boolean'
      || typeof input.checkSnapshotStable !== 'boolean') {
    throw new Error('baseIsAncestor, deadlineExpired and checkSnapshotStable must be booleans');
  }
  if (!Array.isArray(input.changedFiles) || !input.changedFiles.every((path) => typeof path === 'string' && path.length <= 4096)) {
    throw new Error('changedFiles must be an array of bounded strings');
  }
  if (!Array.isArray(input.checkRuns) || input.checkRuns.length > 10_000) throw new Error('checkRuns must be a bounded array');
  for (const run of input.checkRuns) {
    if (!Number.isSafeInteger(run?.id) || run.id <= 0) throw new Error('check run id must be a positive integer');
    if (typeof run.name !== 'string' || run.name.length === 0 || run.name.length > 255) throw new Error('check run name must be bounded');
    if (!SHA_PATTERN.test(run.head_sha ?? '')) throw new Error('check run head_sha must be a full lowercase commit SHA');
    if (typeof run.status !== 'string' || run.status.length === 0 || run.status.length > 50) throw new Error('check run status must be bounded');
    if (run.conclusion !== null && (typeof run.conclusion !== 'string' || run.conclusion.length > 50)) throw new Error('check run conclusion must be null or bounded');
    for (const field of ['created_at', 'started_at', 'completed_at']) {
      if (run[field] !== null && !Number.isFinite(Date.parse(run[field] ?? ''))) throw new Error(`check run ${field} must be null or an ISO timestamp`);
    }
    if (!Number.isSafeInteger(run.app?.id) || typeof run.app?.slug !== 'string') throw new Error('check run app identity is incomplete');
    if (!Number.isSafeInteger(run.check_suite?.id)
        || !SHA_PATTERN.test(run.check_suite?.head_sha ?? '')
        || !Number.isSafeInteger(run.check_suite?.app?.id)
        || typeof run.check_suite?.app?.slug !== 'string') throw new Error('check suite identity is incomplete');
    const workflow = run.workflow_run;
    if (workflow !== null) {
      if (!Number.isSafeInteger(workflow?.id) || workflow.id <= 0
          || !Number.isSafeInteger(workflow.check_suite_id) || workflow.check_suite_id <= 0
          || !Number.isSafeInteger(workflow.run_attempt) || workflow.run_attempt <= 0
          || typeof workflow.name !== 'string' || typeof workflow.path !== 'string'
          || typeof workflow.event !== 'string' || !SHA_PATTERN.test(workflow.head_sha ?? '')
          || !Number.isFinite(Date.parse(workflow.run_started_at ?? ''))
          || !Array.isArray(workflow.pull_requests)) throw new Error('workflow run identity is incomplete');
      for (const pr of workflow.pull_requests) {
        if (!Number.isSafeInteger(pr?.number) || pr.number <= 0
            || !SHA_PATTERN.test(pr?.head?.sha ?? '')
            || typeof pr?.base?.ref !== 'string'
            || !SHA_PATTERN.test(pr?.base?.sha ?? '')) throw new Error('workflow run pull request identity is incomplete');
      }
    }
  }
}

function firstTimestamp(...values) {
  for (const value of values) {
    const timestamp = Date.parse(value ?? '');
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return -1;
}

function compareRuns(left, right) {
  const leftWorkflow = left.workflow_run;
  const rightWorkflow = right.workflow_run;
  const leftStarted = firstTimestamp(leftWorkflow?.run_started_at, left.started_at, left.created_at);
  const rightStarted = firstTimestamp(rightWorkflow?.run_started_at, right.started_at, right.created_at);
  if (leftStarted !== rightStarted) return leftStarted - rightStarted;
  if (leftWorkflow?.id === rightWorkflow?.id && leftWorkflow?.run_attempt !== rightWorkflow?.run_attempt) {
    return leftWorkflow.run_attempt - rightWorkflow.run_attempt;
  }
  if (leftWorkflow?.id !== rightWorkflow?.id) return (leftWorkflow?.id ?? -1) - (rightWorkflow?.id ?? -1);
  if (leftWorkflow?.run_attempt !== rightWorkflow?.run_attempt) {
    return (leftWorkflow?.run_attempt ?? -1) - (rightWorkflow?.run_attempt ?? -1);
  }
  const leftCheckStarted = firstTimestamp(left.started_at, left.created_at);
  const rightCheckStarted = firstTimestamp(right.started_at, right.created_at);
  if (leftCheckStarted !== rightCheckStarted) return leftCheckStarted - rightCheckStarted;
  return left.id - right.id;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deduplicateCheckRuns(checkRuns) {
  const unique = new Map();
  for (const run of checkRuns) {
    const prior = unique.get(run.id);
    if (prior && stableSerialize(prior) !== stableSerialize(run)) {
      return { runs: [], reason: `conflicting-check-run:${run.id}` };
    }
    if (!prior) unique.set(run.id, run);
  }
  return { runs: [...unique.values()], reason: null };
}

function isExpectedApp(app) {
  return app?.id === ACTIONS_APP.id && app?.slug === ACTIONS_APP.slug;
}

function isTrustedRun(run, context, input) {
  const expected = EXPECTED_WORKFLOWS[context];
  const suite = run?.check_suite;
  const workflow = run?.workflow_run;
  if (!expected || !isExpectedApp(run?.app) || !isExpectedApp(suite?.app)) return false;
  if (!Number.isSafeInteger(suite?.id) || suite.id <= 0 || suite.head_sha !== input.currentHeadSha) return false;
  if (!Number.isSafeInteger(workflow?.id) || workflow.id <= 0
      || workflow.check_suite_id !== suite.id
      || !Number.isSafeInteger(workflow.run_attempt) || workflow.run_attempt <= 0
      || workflow.name !== expected.name || workflow.path !== expected.path
      || workflow.event !== 'pull_request' || workflow.head_sha !== input.currentHeadSha) return false;
  if (!Array.isArray(workflow.pull_requests) || workflow.pull_requests.length !== 1) return false;
  const [pr] = workflow.pull_requests;
  return pr?.number === input.currentPrNumber
    && pr?.head?.sha === input.currentHeadSha
    && pr?.base?.ref === input.currentBaseRef
    && pr?.base?.sha === input.currentBaseSha;
}

function latestExactRuns(checkRuns, headSha, evidenceNotBefore) {
  const cutoff = Date.parse(evidenceNotBefore);
  const latest = new Map();
  for (const run of checkRuns) {
    if (run.head_sha !== headSha) continue;
    const started = Date.parse(run.workflow_run?.run_started_at ?? run.started_at ?? run.created_at ?? '');
    if (run.status === 'completed' && run.conclusion === 'success' && started < cutoff) continue;
    const prior = latest.get(run.name);
    if (!prior || compareRuns(run, prior) > 0) latest.set(run.name, run);
  }
  return latest;
}

export function evaluateRequiredChecks(input) {
  validateInput(input);
  const requiredContexts = classifyChanges(input.changedFiles).requiredContexts;

  if (input.prNumber !== input.currentPrNumber) return fail(requiredContexts, 'wrong-pr');
  if (input.eventHeadSha !== input.currentHeadSha) return fail(requiredContexts, 'obsolete-head');
  if (input.eventBaseSha !== input.currentBaseSha) return fail(requiredContexts, 'retargeted-base');
  if (input.evaluatorBaseSha !== input.currentBaseSha) return fail(requiredContexts, 'wrong-evaluator-base');
  if (input.protectedPrCount !== 1) return fail(requiredContexts, 'ambiguous-head');
  if (input.reportedChangedFileCount !== input.listedChangedFileCount) return fail(requiredContexts, 'incomplete-files');
  if (input.currentPrState !== 'open') return fail(requiredContexts, 'pr-not-open');
  if (input.currentBaseRef !== input.expectedBaseRef) return fail(requiredContexts, 'unexpected-base');
  if (!input.baseIsAncestor) return fail(requiredContexts, 'obsolete-base');

  const deduplicated = deduplicateCheckRuns(input.checkRuns);
  if (deduplicated.reason) return fail(requiredContexts, deduplicated.reason);
  if (deduplicated.runs.length !== input.reportedCheckRunCount) return fail(requiredContexts, 'incomplete-check-runs');
  if (!input.checkSnapshotStable) {
    if (input.deadlineExpired) return fail(requiredContexts, 'unstable-check-snapshot');
    return {
      schemaVersion: 1,
      state: 'pending',
      description: 'waiting for a stable complete check snapshot',
      requiredContexts,
      reasons: ['unstable-check-snapshot'],
    };
  }

  const latest = latestExactRuns(deduplicated.runs, input.eventHeadSha, input.evidenceNotBefore);
  const missing = [];
  const pending = [];
  const failed = [];

  for (const context of requiredContexts) {
    const run = latest.get(context);
    if (!run) {
      missing.push(`missing:${context}`);
      continue;
    }
    if (!isTrustedRun(run, context, input)) {
      failed.push(`untrusted:${context}`);
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
