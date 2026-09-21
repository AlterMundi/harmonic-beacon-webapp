import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDelivery } from '../delivery-status.mjs';

const repo = 'AlterMundi/harmonic-beacon-webapp';
const head = 'a'.repeat(40), base = 'b'.repeat(40), merge = 'c'.repeat(40);
const initial = { number: 554, state: 'open', draft: false, head: { sha: head }, base: { sha: base, ref: 'main' }, merge_commit_sha: merge };
const status = (id, state, context = 'delivery-gate-main') => ({ id, state, context, target_url: `https://github.com/${repo}/actions/runs/10` });
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
      return {
        required_status_checks: { checks: [{ context: options.protectedContext ?? 'delivery-gate-main', app_id: 15368 }] },
        required_pull_request_reviews: { required_approving_review_count: options.approvals ?? 0 },
      };
    }
    if (path.includes('/check-runs?')) return options.checks ?? [{ total_count: 0, check_runs: [] }];
    if (path.includes(`/commits/${head}/statuses?`)) return options.head ?? [[]];
    if (path.includes(`/commits/${merge}/statuses?`)) return options.merge ?? [[]];
    throw new Error('unexpected read');
  };
  return { read, calls };
}

test('branch-qualified protection reads its gate from the stable head', async () => {
  const { read } = fixture({ head: [[status(1, 'success')]], checks: [{ total_count: 1, check_runs: [check(1, 'success')] }] });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.gate.merge.state, 'missing');
  assert.equal(report.gate.head.state, 'success');
  assert.deepEqual(report.gate.protected.map(({ context, target, status: observed }) => ({ context, target, state: observed.state })), [
    { context: 'delivery-gate-main', target: 'head', state: 'success' },
  ]);
  assert.ok(!report.next.some(value => value.includes('Required delivery-gate')));
  assert.ok(!report.next.some(value => value.includes('approval')));
  assert.equal(report.requiredApprovals, 0);
  assert.equal(report.production, 'not-inspected');
  assert.equal(report.reviewDecision, 'REVIEW_REQUIRED');
  assert.equal('safeToMerge' in report, false);
});

test('synthetic merge movement does not invalidate a head-gate snapshot', async () => {
  const { read } = fixture({ final: { ...initial, merge_commit_sha: 'd'.repeat(40) } });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.stable, true);
});

test('legacy protected merge gate remains visible and merge movement invalidates it', async () => {
  const { read } = fixture({
    protectedContext: 'delivery-gate',
    final: { ...initial, merge_commit_sha: 'd'.repeat(40) },
  });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.stable, false);
  assert.equal(report.gate.protected[0].target, 'merge');
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

test('latest legacy status wins across pages; unrelated contexts do not authorize', async () => {
  const { read } = fixture({
    protectedContext: 'delivery-gate',
    merge: [[status(2, 'pending', 'delivery-gate'), status(100, 'success', 'delivery-gate-shadow')], [status(1, 'success', 'delivery-gate')]],
  });
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
    assert.ok(!report.unknown.includes('mergeIdentity'));
    assert.ok(!calls.some(args => args.at(-1).includes(`/commits/${merge}/statuses`)));
  }
});

test('legacy protection still reports an unavailable merge identity during migration', async () => {
  const { read } = fixture({
    protectedContext: 'delivery-gate',
    initial: { ...initial, merge_commit_sha: null },
  });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.ok(report.unknown.includes('mergeIdentity'));
  assert.deepEqual(report.gate.protected.map(({ context, target }) => ({ context, target })), [
    { context: 'delivery-gate', target: 'merge' },
  ]);
});

test('temporary automatic bootstrap protection does not invent a delivery-gate error', async () => {
  const { read } = fixture({ protectedContext: 'required-impact-checks' });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.deepEqual(report.gate.protected, []);
  assert.ok(!report.next.some(value => value.includes('Required delivery-gate')));
});

test('legacy missing merge and unsafe status details remain bounded during bootstrap', async () => {
  const { read } = fixture({
    protectedContext: 'delivery-gate',
    merge: [[{ ...status(1, 'failure', 'delivery-gate'), target_url: 'https://other.invalid/?token=secret', description: 'private contents' }]],
  });
  const report = await inspectDelivery({ repo, pr: 554 }, read);
  assert.equal(report.gate.merge.run, null);
  assert.ok(!JSON.stringify(report).includes('secret'));
  assert.ok(!JSON.stringify(report).includes('private contents'));
});

test('approval guidance follows the configured approval count', async () => {
  const none = await inspectDelivery({ repo, pr: 554 }, fixture({ approvals: 0 }).read);
  assert.ok(!none.next.some(value => value.includes('approval')));
  const two = await inspectDelivery({ repo, pr: 554 }, fixture({ approvals: 2 }).read);
  assert.ok(two.next.some(value => value.includes('requires 2 approvals')));
});

test('invalid target makes no request', async () => {
  const read = () => { throw new Error('must not be called'); };
  await assert.rejects(inspectDelivery({ repo: '../wrong', pr: 554 }, read), /invalid repository/);
  await assert.rejects(inspectDelivery({ repo, pr: NaN }, read), /invalid repository/);
});
