#!/usr/bin/env node
// Reuse complete successful PR qualification only when the protected base and
// every non-documentation byte are identical. Failures/unavailable evidence
// fall back to normal checks. No commit statuses are copied or forged.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function documentationOnly(paths) {
  return paths.length > 0 && paths.every(path =>
    path === 'README.md' || /^(docs|deploy)\/[^\r\n\0]+\.md$/.test(path));
}
export function eligibleRun(run, current, now = Date.now()) {
  return run.id !== current.runId && run.status === 'completed' && run.conclusion === 'success'
    && run.event === 'pull_request' && run.path === '.github/workflows/ci.yml'
    && /^[a-f0-9]{40}$/.test(run.head_sha ?? '')
    && now - Date.parse(run.created_at) >= 0 && now - Date.parse(run.created_at) < 24 * 3600_000
    && run.head_repository?.full_name === current.repository
    && run.pull_requests?.some(pr => pr.number === current.prNumber
      && pr.base.sha === current.base && pr.base.ref === current.baseRef);
}
export function qualifiedJobs(jobs, required) {
  return required.every(name => jobs.filter(job => job.name === name).length === 1
    && jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'
      // Never extend the age of evidence by chaining reuse runs.
      && !job.steps?.some(step => step.name === 'Reuse unchanged-source qualification' && step.conclusion === 'success')));
}
function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }));
}
export function findEvidence(environment = process.env) {
  if (environment.GITHUB_EVENT_NAME !== 'pull_request') return null;
  const event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (pr.head.repo.full_name !== environment.GITHUB_REPOSITORY) return null;
  const current = { repository: environment.GITHUB_REPOSITORY, runId: Number(environment.GITHUB_RUN_ID),
    prNumber: pr.number, base: pr.base.sha, baseRef: pr.base.ref };
  const plan = JSON.parse(readFileSync('impact-plan.json', 'utf8'));
  const required = ['diff-check', 'required-impact-checks', ...plan.requiredJobChecks.flatMap(name => name === 'e2e' ? ['e2e / e2e', 'e2e / account'] : [name])];
  const prefix = 'repos/' + current.repository;
  const runs = gh(prefix + '/actions/workflows/ci.yml/runs?event=pull_request&status=success&per_page=30&branch=' + encodeURIComponent(pr.head.ref)).workflow_runs;
  for (const run of runs) {
    if (!eligibleRun(run, current)) continue;
    const paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', run.head_sha, pr.head.sha], { encoding: 'utf8', timeout: 10_000 }).split('\0').filter(Boolean);
    if (!documentationOnly(paths)) continue;
    const response = gh(prefix + '/actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100');
    if (response.total_count !== response.jobs.length || !qualifiedJobs(response.jobs, required)) continue;
    // Re-read the run, so a rerun racing evidence discovery cannot qualify.
    const final = gh(prefix + '/actions/runs/' + run.id);
    if (!eligibleRun(final, current) || final.run_attempt !== run.run_attempt) continue;
    return { runId: run.id, runAttempt: run.run_attempt, sourceSha: run.head_sha,
      headSha: pr.head.sha, baseSha: pr.base.sha, baseRef: pr.base.ref, documentationPaths: paths,
      url: run.html_url, observedAt: new Date().toISOString() };
  }
  return null;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let evidence = null;
  try { evidence = findEvidence(); }
  catch { console.log('Prior qualification unavailable: running normal checks.'); }
  writeFileSync('ci-equivalence.json', JSON.stringify({ schemaVersion: 1, evidence }, null, 2) + '\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `reuse_run=${evidence?.runId ?? ''}\n`);
  console.log(evidence ? `Unchanged non-documentation source; qualification: ${evidence.url}` : 'Fresh qualification required.');
}
