#!/usr/bin/env node

import { createHash } from 'node:crypto';

const API_ROOT = 'https://api.github.com/repos/AlterMundi/harmonic-beacon-webapp';
export const REVIEWED_WORKFLOW_SHA256 = Object.freeze({
  delivery: 'bdc1f2c9fdf05d44c852b83a435f2b8c3bb6b9df6c54f721bb27e24cc639290c',
  ci: '2272c7c464f9d0801a82839006ceed3519ff8678d402b9ef8202ec2c6d8ce9a2',
});
export const EXPECTED_CI_CHECKS = Object.freeze([
  'quota-postgres',
  'stream-origin',
  'observability-config',
  'staging-preview',
  'identity-cache',
  'network-resilience (chromium)',
  'network-resilience (firefox)',
  'network-resilience (android-chrome)',
  'network-resilience (iphone-webkit)',
]);

function reject(message) { throw new Error(`Listen GitHub gate: ${message}`); }
function exactNames(values, label) {
  const actual = values.map((value) => value.name).sort();
  const expected = [...EXPECTED_CI_CHECKS].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) reject(`${label} set is incomplete or open`);
  if (new Set(actual).size !== actual.length) reject(`${label} set contains duplicates`);
}
function instant(value, label) {
  const parsed = Date.parse(value ?? '');
  if (!Number.isFinite(parsed)) reject(`${label} timestamp is invalid`);
  return parsed;
}

export function validateDeliveryRun(run, binding) {
  if (run.id !== Number(binding.delivery_run_id) || run.run_attempt !== Number(binding.delivery_run_attempt) ||
      run.head_sha !== binding.source_sha || run.head_branch !== 'early-birds' || run.event !== 'workflow_dispatch' ||
      run.path !== '.github/workflows/listener-delivery.yml' || run.status !== 'in_progress') reject('delivery run identity is invalid');
  return run;
}

export function validateDeliveryEvidence(run, jobsResponse, binding) {
  validateDeliveryRun(run, binding);
  const jobs = jobsResponse?.jobs;
  if (!Array.isArray(jobs) || jobsResponse.total_count !== jobs.length || jobs.length !== 4 ||
      jobs.map((job) => job.name).sort().join(',') !== 'bind-dispatch,contract,production,staging') reject('delivery job set is incomplete');
  const bindingJob = jobs.find((job) => job.name === 'bind-dispatch');
  if (!bindingJob || bindingJob.run_id !== run.id || bindingJob.run_attempt !== run.run_attempt ||
      bindingJob.status !== 'completed' || bindingJob.conclusion !== 'success') reject('delivery binding job is not successful');
  const contractJob = jobs.find((job) => job.name === 'contract');
  if (!contractJob || contractJob.run_id !== run.id || contractJob.run_attempt !== run.run_attempt ||
      contractJob.status !== 'completed' || contractJob.conclusion !== 'skipped') reject('pull-request contract job is not skipped');
  const targetJob = jobs.find((job) => job.name === binding.target);
  if (!targetJob || targetJob.run_id !== run.id || targetJob.run_attempt !== run.run_attempt || targetJob.status !== 'in_progress' || targetJob.conclusion !== null) reject('delivery target job is not current');
  const otherJob = jobs.find((job) => ['staging', 'production'].includes(job.name) && job.name !== binding.target);
  if (!otherJob || otherJob.run_id !== run.id || otherJob.run_attempt !== run.run_attempt || otherJob.status !== 'completed' || otherJob.conclusion !== 'skipped') reject('non-target delivery job is not skipped');
  const expectedStep = binding.operation === 'deploy' && binding.checkpoint_mode === 'interrupt'
    ? 'Run rollback rehearsal checkpoint with cleanup proof'
    : ({
        probe: `Probe ${binding.target} adapter`,
        status: `Show ${binding.target} status`,
        preflight: `Preflight ${binding.target} delivery`,
        deploy: `Deploy ${binding.target} Listener`,
        smoke: `Smoke ${binding.target} Listener`,
        rollback: `Roll back ${binding.target} Listener`,
      })[binding.operation];
  const activeSteps = (targetJob.steps ?? []).filter((step) => step.status === 'in_progress' && step.conclusion === null);
  if (!expectedStep || activeSteps.length !== 1 || activeSteps[0].name !== expectedStep) reject('delivery operation step is not current');
  return { run, jobs, step: activeSteps[0] };
}

export function validateCiEvidence(run, jobsResponse, checksResponse, binding) {
  if (run.id !== Number(binding.ci_run_id) || run.run_attempt !== Number(binding.ci_run_attempt) ||
      run.head_sha !== binding.source_sha || run.head_branch !== 'early-birds' || run.event !== 'push' ||
      run.path !== '.github/workflows/early-birds-fast-forward.yml' || run.status !== 'completed' || run.conclusion !== 'success') reject('CI run identity is invalid');
  const attemptStarted = instant(run.run_started_at, 'CI attempt start');
  const jobs = jobsResponse?.jobs;
  if (!Array.isArray(jobs) || jobsResponse.total_count !== jobs.length) reject('CI jobs response is truncated');
  exactNames(jobs, 'CI job');
  for (const job of jobs) {
    if (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.status !== 'completed' || job.conclusion !== 'success') reject('CI job is stale, skipped, open, or unsuccessful');
    if (instant(job.started_at, 'CI job start') < attemptStarted || instant(job.completed_at, 'CI job completion') < instant(job.started_at, 'CI job start')) reject('CI job time is outside the exact attempt');
  }
  const runUrl = `/actions/runs/${run.id}/job/`;
  const allChecks = checksResponse?.check_runs;
  if (!Array.isArray(allChecks) || checksResponse.total_count !== allChecks.length) reject('CI checks response is truncated');
  const checks = allChecks.filter((check) => typeof check.details_url === 'string' && check.details_url.includes(runUrl));
  exactNames(checks, 'CI check');
  for (const check of checks) {
    if (check.app?.slug !== 'github-actions' || check.check_suite?.head_sha !== binding.source_sha || check.status !== 'completed' || check.conclusion !== 'success') reject('CI check is foreign, skipped, open, or unsuccessful');
    if (instant(check.started_at, 'CI check start') < attemptStarted || instant(check.completed_at, 'CI check completion') < instant(check.started_at, 'CI check start')) reject('CI check time is outside the exact attempt');
  }
  return { run, jobs, checks };
}

export function verifyReviewedWorkflowBytes(kind, bytes) {
  if (!Object.hasOwn(REVIEWED_WORKFLOW_SHA256, kind) || !Buffer.isBuffer(bytes) || createHash('sha256').update(bytes).digest('hex') !== REVIEWED_WORKFLOW_SHA256[kind]) reject('reviewed workflow digest mismatch');
  return bytes;
}

export async function fetchJson(pathname, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_ROOT}${pathname}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'hb-listener-delivery-v1' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) reject('GitHub evidence is unavailable');
  return response.json();
}
async function fetchBytes(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { accept: 'application/octet-stream', 'user-agent': 'hb-listener-delivery-v1' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) reject('reviewed workflow bytes are unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 131_072) reject('reviewed workflow byte length is invalid');
  return bytes;
}
export async function fetchAndValidateDelivery(binding, fetchImpl = fetch) {
  const run = await fetchJson(`/actions/runs/${binding.delivery_run_id}`, fetchImpl);
  const jobs = await fetchJson(`/actions/runs/${binding.delivery_run_id}/attempts/${binding.delivery_run_attempt}/jobs?filter=all&per_page=100`, fetchImpl);
  const sourceRoot = `https://raw.githubusercontent.com/AlterMundi/harmonic-beacon-webapp/${binding.source_sha}/.github/workflows`;
  verifyReviewedWorkflowBytes('delivery', await fetchBytes(`${sourceRoot}/listener-delivery.yml`, fetchImpl));
  verifyReviewedWorkflowBytes('ci', await fetchBytes(`${sourceRoot}/early-birds-fast-forward.yml`, fetchImpl));
  return validateDeliveryEvidence(run, jobs, binding);
}
export async function fetchAndValidateCi(binding, fetchImpl = fetch) {
  const run = await fetchJson(`/actions/runs/${binding.ci_run_id}`, fetchImpl);
  const jobs = await fetchJson(`/actions/runs/${binding.ci_run_id}/attempts/${binding.ci_run_attempt}/jobs?filter=all&per_page=100`, fetchImpl);
  const checks = await fetchJson(`/commits/${binding.source_sha}/check-runs?filter=all&per_page=100`, fetchImpl);
  return validateCiEvidence(run, jobs, checks, binding);
}

export { API_ROOT };
