import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDelivery } from '../delivery-status.mjs';

const repo = 'AlterMundi/harmonic-beacon-webapp';
const head = 'a'.repeat(40), base = 'b'.repeat(40), merge = 'c'.repeat(40);
const initial = { number: 554, state: 'open', draft: false, head: { sha: head }, base: { sha: base, ref: 'main' }, merge_commit_sha: merge };
const status = (id, state, context = 'delivery-gate') => ({ id, state, context, target_url: `https://github.com/${repo}/actions/runs/10` });
const check = (id, conclusion) => ({ id, name: 'e2e', status: 'completed', conclusion });

function fixture(options = {}) {
  let reads = 0;
  const calls = [];
  const read = async args => {
    calls.push(args);
    if (args[0] === 'pr') return { reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' };
    assert.equal(args[0], 'api');
    assert.equal(args[args.indexOf('--method') + 1], 'GET');
    const path = args.at(-1);
    assert.ok(path.startsWith(`repos/${repo}/`));
    if (path.endsWith('pulls/554')) return structuredClone(++reads === 1 ? options.initial ?? initial : options.final ?? options.initial ?? initial);
    if (path.endsWith('/protection')) {
      if (options.unavailable) throw new Error('secret server response');
      return { required_status_checks: { checks: [{ context: 'delivery-gate', app_id: 15368 }] } };
    }
    if (path.includes('/check-runs?')) return options.checks ?? [{ total_count: 0, check_runs: [] }];
    if (path.includes(`/commits/${head}/statuses?`)) return options.head ?? [[]];
    if (path.includes(`/commits/${merge}/statuses?`)) return options.merge ?? [[]];
    throw new Error('unexpected read');
  };
  return { read, calls };
}

test('missing merge gate is visible even with successful head checks/status', async () => {
  const { read } = fixture({ head: [[status(1, 'success')]], checks: [{ total_count: 1, check_runs: [check(1, 'success')] }] });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.gate.merge.state, 'missing');
  assert.ok(report.next.some(value => value.includes('Current merge has no')));
  assert.equal(report.production, 'not-inspected');
  assert.equal(report.reviewDecision, 'REVIEW_REQUIRED');
  assert.equal('safeToMerge' in report, false);
});

test('merge movement with unchanged head/base invalidates snapshot', async () => {
  const { read } = fixture({ final: { ...initial, merge_commit_sha: 'd'.repeat(40) } });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.stable, false);
});

test('head, base, state and draft changes invalidate snapshot', async () => {
  for (const change of [{ head: { sha: 'd'.repeat(40) } }, { base: { sha: 'd'.repeat(40), ref: 'main' } }, { state: 'closed' }, { draft: true }]) {
    const { read } = fixture({ final: { ...initial, ...change } });
    assert.equal((await inspectDelivery({ repo, pr: 554 }, read)).stable, false);
  }
});

test('unavailable protection stays unknown without leaking raw errors', async () => {
  const { read } = fixture({ unavailable: true });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.ok(report.unknown.includes('protection'));
  assert.equal(report.requiredContexts, null);
  assert.ok(!JSON.stringify(report).includes('secret server response'));
});

test('latest status wins across pages; unrelated contexts do not authorize', async () => {
  const { read } = fixture({ merge: [[status(2, 'pending'), status(100, 'success', 'delivery-gate-shadow')], [status(1, 'success')]] });
  assert.equal((await inspectDelivery({ repo, pr: 554 }, read)).gate.merge.state, 'pending');
});

test('diagnostic preserves conflicting check attempts instead of picking a green one', async () => {
  const { read } = fixture({ checks: [{ total_count: 2, check_runs: [check(2, 'failure')] }, { total_count: 2, check_runs: [check(1, 'success')] }] });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.deepEqual(report.checks.map(row => row.conclusion), ['failure', 'success']);
});

test('truncated check inventory is unknown', async () => {
  const { read } = fixture({ checks: [{ total_count: 2, check_runs: [check(1, 'success')] }] });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.checks, null);
  assert.ok(report.unknown.includes('checks'));
});

test('null merge and closed PR do not query a nonexistent or misleading merge ref', async () => {
  for (const change of [{ merge_commit_sha: null }, { state: 'closed' }]) {
    const { read, calls } = fixture({ initial: { ...initial, ...change } });
    const report = await inspectDelivery({ repo, pr: 554 }, read);
    assert.equal(report.gate.merge, null);
    assert.ok(!calls.some(args => args.at(-1).includes(`/commits/${merge}/statuses`)));
  }
});

test('raw descriptions and signed/external URLs are not exported', async () => {
  const { read } = fixture({ merge: [[{ ...status(1, 'failure'), target_url: 'https://other.invalid/?token=secret', description: 'private contents' }]] });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.gate.merge.run, null);
  assert.ok(!JSON.stringify(report).includes('secret'));
  assert.ok(!JSON.stringify(report).includes('private contents'));
});

test('invalid target makes no request', async () => {
  const read = () => { throw new Error('must not be called'); };
  await assert.rejects(inspectDelivery({ repo: '../wrong', pr: 554 }, read), /invalid repository/);
  await assert.rejects(inspectDelivery({ repo, pr: NaN }, read), /invalid repository/);
});
