#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from './change-impact.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PENDING_STATUSES = new Set(['queued', 'in_progress', 'pending', 'requested', 'waiting']);
const MAX_REASONS = 20;
const ACTIONS_APP = Object.freeze({ id: 15368, slug: 'github-actions' });
const CI_WORKFLOW = Object.freeze({ name: 'CI', path: '.github/workflows/ci.yml' });
const E2E_WORKFLOW = Object.freeze({ name: 'E2E quality gates', path: '.github/workflows/e2e.yml' });
const AUDIO_WORKFLOW = Object.freeze({ name: 'Audio boundary', path: '.github/workflows/audio-boundary.yml' });
const LEGACY_EXPECTED_WORKFLOWS = Object.freeze({
  'diff-check': { name: 'CI', path: '.github/workflows/ci.yml' },
  impact: CI_WORKFLOW,
  'lint-and-build': { name: 'CI', path: '.github/workflows/ci.yml' },
  test: { name: 'CI', path: '.github/workflows/ci.yml' },
  tapestry: { name: 'CI', path: '.github/workflows/ci.yml' },
  playlist: { name: 'CI', path: '.github/workflows/ci.yml' },
  analytics: { name: 'CI', path: '.github/workflows/ci.yml' },
  e2e: E2E_WORKFLOW,
  account: E2E_WORKFLOW,
  'frozen-audio-paths': AUDIO_WORKFLOW,
});
const INTEGRATED_JOB_NAMES = Object.freeze({
  e2e: ['e2e / e2e', 'e2e / account'],
});

// C2 policy selection: this commit is safe only after C1 is present on the
// protected base. Keep the legacy verifier available for rollback diagnosis,
// but never combine checks from the two forms in one decision.
export const ACTIVE_EVIDENCE_FORM = 'integrated-v2';

function evidenceRequirements(changedFiles, evidenceForm) {
  const impact = classifyChanges(changedFiles);
  if (evidenceForm === 'legacy-v1') {
    return impact.requiredContexts.map((context) => ({
      key: context,
      context,
      expected: LEGACY_EXPECTED_WORKFLOWS[context],
    }));
  }
  if (evidenceForm !== 'integrated-v2') throw new Error('unknown evidence form');
  const requirements = [{ key: 'diff-check', context: 'diff-check', expected: CI_WORKFLOW }];
  for (const job of impact.requiredJobChecks) {
    for (const context of INTEGRATED_JOB_NAMES[job] ?? [job]) {
      requirements.push({ key: context, context, expected: CI_WORKFLOW });
    }
    if (job === 'frozen-audio-paths') {
      requirements.push({
        key: 'audio-label-policy',
        context: 'frozen-audio-paths',
        expected: AUDIO_WORKFLOW,
      });
    }
  }
  requirements.push({
    key: 'required-impact-checks',
    context: 'required-impact-checks',
    expected: CI_WORKFLOW,
  });
  return requirements.filter((requirement, index) =>
    requirements.findIndex(({ key }) => key === requirement.key) === index);
}

function knownAlternativeWorkflow(run, requirement) {
  if (!isExpectedApp(run?.app) || !isExpectedApp(run?.check_suite?.app)) return false;
  const workflow = run?.workflow_run;
  const known = [LEGACY_EXPECTED_WORKFLOWS[requirement.context], CI_WORKFLOW].filter(Boolean);
  return known.some((expected) => workflow?.name === expected.name && workflow?.path === expected.path)
    && !(workflow?.name === requirement.expected?.name && workflow?.path === requirement.expected?.path);
}

function workflowKey(expected) {
  return `${expected.name}\u0000${expected.path}`;
}

function matchesWorkflow(run, expected) {
  return run?.workflow_run?.name === expected.name
    && run?.workflow_run?.path === expected.path;
}

function sameWorkflowAttempt(left, right) {
  return left?.workflow_run?.id === right?.workflow_run?.id
    && left?.workflow_run?.run_attempt === right?.workflow_run?.run_attempt;
}

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
    const job = run.workflow_job;
    if (job !== null) {
      if (!Number.isSafeInteger(job?.id) || job.id <= 0
          || !Number.isSafeInteger(job.run_id) || job.run_id <= 0
          || !Number.isSafeInteger(job.run_attempt) || job.run_attempt <= 0
          || !Number.isSafeInteger(job.check_run_id) || job.check_run_id <= 0
          || !SHA_PATTERN.test(job.head_sha ?? '')
          || typeof job.name !== 'string' || job.name.length === 0 || job.name.length > 255
          || typeof job.status !== 'string' || job.status.length === 0 || job.status.length > 50
          || (job.conclusion !== null && (typeof job.conclusion !== 'string' || job.conclusion.length > 50))) {
        throw new Error('workflow job identity is incomplete');
      }
      for (const field of ['started_at', 'completed_at']) {
        if (job[field] !== null && !Number.isFinite(Date.parse(job[field] ?? ''))) {
          throw new Error(`workflow job ${field} must be null or an ISO timestamp`);
        }
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

function isTrustedRun(run, requirement, input) {
  const expected = requirement.expected;
  const suite = run?.check_suite;
  const workflow = run?.workflow_run;
  const job = run?.workflow_job;
  if (!expected || !isExpectedApp(run?.app) || !isExpectedApp(suite?.app)) return false;
  if (!Number.isSafeInteger(suite?.id) || suite.id <= 0 || suite.head_sha !== input.currentHeadSha) return false;
  if (!Number.isSafeInteger(workflow?.id) || workflow.id <= 0
      || workflow.check_suite_id !== suite.id
      || !Number.isSafeInteger(workflow.run_attempt) || workflow.run_attempt <= 0
      || workflow.name !== expected.name || workflow.path !== expected.path
      || workflow.event !== 'pull_request' || workflow.head_sha !== input.currentHeadSha) return false;
  if (!Number.isSafeInteger(job?.id) || job.id <= 0
      || job.run_id !== workflow.id || job.run_attempt !== workflow.run_attempt
      || job.check_run_id !== run.id || job.head_sha !== input.currentHeadSha
      || job.name !== run.name || job.status !== run.status || job.conclusion !== run.conclusion) return false;
  const attemptStarted = Date.parse(workflow.run_started_at);
  for (const value of [run.created_at, run.started_at, run.completed_at, job.started_at, job.completed_at]) {
    const timestamp = Date.parse(value ?? '');
    if (Number.isFinite(timestamp) && timestamp < attemptStarted) return false;
  }
  if (!Array.isArray(workflow.pull_requests) || workflow.pull_requests.length !== 1) return false;
  const [pr] = workflow.pull_requests;
  return pr?.number === input.currentPrNumber
    && pr?.head?.sha === input.currentHeadSha
    && pr?.base?.ref === input.currentBaseRef
    && pr?.base?.sha === input.currentBaseSha;
}

function latestExactRuns(checkRuns, requirements, headSha, evidenceNotBefore) {
  const cutoff = Date.parse(evidenceNotBefore);
  const newestWorkflowAttempts = new Map();
  for (const requirement of requirements) {
    const key = workflowKey(requirement.expected);
    if (newestWorkflowAttempts.has(key)) continue;
    for (const run of checkRuns) {
      if (run.head_sha !== headSha || !matchesWorkflow(run, requirement.expected)
          || !isExpectedApp(run?.app) || !isExpectedApp(run?.check_suite?.app)) continue;
      const started = Date.parse(run.workflow_run?.run_started_at ?? run.started_at ?? run.created_at ?? '');
      if (run.status === 'completed' && run.conclusion === 'success' && started < cutoff) continue;
      const prior = newestWorkflowAttempts.get(key);
      if (!prior || compareRuns(run, prior) > 0) newestWorkflowAttempts.set(key, run);
    }
  }
  const latest = new Map();
  for (const requirement of requirements) {
    const newestAttempt = newestWorkflowAttempts.get(workflowKey(requirement.expected));
    for (const run of checkRuns) {
      if (run.name !== requirement.context || run.head_sha !== headSha) continue;
      if (knownAlternativeWorkflow(run, requirement)) continue;
      if (matchesWorkflow(run, requirement.expected)
          && newestAttempt && !sameWorkflowAttempt(run, newestAttempt)) continue;
      const started = Date.parse(run.workflow_run?.run_started_at ?? run.started_at ?? run.created_at ?? '');
      if (run.status === 'completed' && run.conclusion === 'success' && started < cutoff) continue;
      const prior = latest.get(requirement.key);
      if (!prior || compareRuns(run, prior) > 0) latest.set(requirement.key, run);
    }
  }
  return latest;
}

export function evaluateRequiredChecksForEvidenceForm(input, evidenceForm) {
  validateInput(input);
  const requirements = evidenceRequirements(input.changedFiles, evidenceForm);
  const requiredContexts = requirements.map(({ key }) => key);

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

  const latest = latestExactRuns(deduplicated.runs, requirements, input.eventHeadSha, input.evidenceNotBefore);
  const missing = [];
  const pending = [];
  const failed = [];

  for (const requirement of requirements) {
    const { context, key } = requirement;
    const run = latest.get(key);
    if (!run) {
      missing.push(`missing:${key}`);
      continue;
    }
    if (!isTrustedRun(run, requirement, input)) {
      failed.push(`untrusted:${key}`);
      continue;
    }
    if (PENDING_STATUSES.has(run.status)) {
      pending.push(`pending:${key}:${run.status}`);
      continue;
    }
    if (run.status !== 'completed') {
      failed.push(`status:${key}:${String(run.status ?? 'missing')}`);
      continue;
    }
    if (run.conclusion !== 'success') failed.push(`conclusion:${key}:${String(run.conclusion ?? 'missing')}`);
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

export function evaluateRequiredChecks(input) {
  return evaluateRequiredChecksForEvidenceForm(input, ACTIVE_EVIDENCE_FORM);
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
