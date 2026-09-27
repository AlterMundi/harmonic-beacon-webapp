import test from 'node:test';
import assert from 'node:assert/strict';
import { documentationOnly, eligibleRun, qualifiedJobs } from '../reuse-documentation-evidence.mjs';

test('only ordinary documentation can reuse complete qualification', () => {
  assert.equal(documentationOnly(['deploy/README.md', 'docs/ops/OPERATOR_LOOP.md']), true);
  for (const paths of [[], ['src/app/page.tsx'], ['docs/tool.mjs'], ['contracts/commerce-entitlement/README.md'], ['.github/workflows/ci.yml'], ['package-lock.json'], ['README.md', 'src/a.md']]) assert.equal(documentationOnly(paths), false);
});
test('qualification is bound to same PR, base, repo, completed attempt and age', () => {
  const now = Date.now();
  const current = { runId: 2, repository: 'owner/repo', prNumber: 9, base: 'b'.repeat(40), baseRef: 'release' };
  const run = { id: 1, status: 'completed', conclusion: 'success', event: 'pull_request', path: '.github/workflows/ci.yml', head_sha: 'a'.repeat(40), created_at: new Date(now - 1000).toISOString(), head_repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 9, base: { sha: current.base, ref: 'release' } }] };
  assert.equal(eligibleRun(run, current, now), true);
  for (const override of [{id:2}, {conclusion:'failure'}, {status:'in_progress'}, {event:'push'}, {created_at:new Date(now-86400001).toISOString()}, {head_repository:{full_name:'fork/repo'}}, {pull_requests:[{number:9,base:{sha:'c'.repeat(40),ref:'release'}}]}]) assert.equal(eligibleRun({...run,...override}, current, now), false);
});
test('selected jobs must be successful, unique and actually executed, never chained', () => {
  const job = { name: 'test', status: 'completed', conclusion: 'success', steps: [] };
  assert.equal(qualifiedJobs([job], ['test']), true);
  for (const jobs of [[], [job,job], [{...job, conclusion:'skipped'}], [{...job,steps:[{name:'Reuse unchanged-source qualification',conclusion:'success'}]}]]) assert.equal(qualifiedJobs(jobs, ['test']), false);
});
