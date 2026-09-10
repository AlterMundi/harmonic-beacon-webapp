import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateRequiredChecks } from '../../ci/required-checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';

function checkRun(name, overrides = {}) {
  return {
    id: overrides.id ?? 1,
    name,
    head_sha: overrides.head_sha ?? HEAD,
    status: overrides.status ?? 'completed',
    conclusion: overrides.conclusion === undefined ? 'success' : overrides.conclusion,
    completed_at: Object.hasOwn(overrides, 'completed_at') ? overrides.completed_at : null,
    started_at: Object.hasOwn(overrides, 'started_at') ? overrides.started_at : '2026-09-10T00:01:00.000Z',
    created_at: Object.hasOwn(overrides, 'created_at') ? overrides.created_at : '2026-09-10T00:01:00.000Z',
  };
}

function input(overrides = {}) {
  return {
    prNumber: 534,
    expectedBaseRef: 'main',
    eventHeadSha: HEAD,
    eventBaseSha: BASE,
    currentPrNumber: 534,
    currentPrState: 'open',
    currentHeadSha: HEAD,
    currentBaseSha: BASE,
    currentBaseRef: 'main',
    baseIsAncestor: true,
    evidenceNotBefore: '2026-09-10T00:00:00.000Z',
    protectedPrCount: 1,
    reportedChangedFileCount: 1,
    listedChangedFileCount: 1,
    changedFiles: ['docs/ops/example.md'],
    checkRuns: [checkRun('diff-check')],
    deadlineExpired: false,
    ...overrides,
  };
}

function appRuns(overrides = {}) {
  return ['diff-check', 'lint-and-build', 'test', 'e2e', 'account'].map((name, index) =>
    checkRun(name, { id: index + 1, ...(overrides[name] ?? {}) }),
  );
}

function assertState(actual, state, reason) {
  assert.equal(actual.state, state);
  if (reason) assert.ok(actual.reasons.includes(reason), JSON.stringify(actual));
}

test('succeeds when every required context passed on the exact current head', () => {
  assert.deepEqual(evaluateRequiredChecks(input()), {
    schemaVersion: 1,
    state: 'success',
    description: 'all 1 required checks succeeded',
    requiredContexts: ['diff-check'],
    reasons: [],
  });
});

test('succeeds when every selected application context passed on the exact head', () => {
  const result = evaluateRequiredChecks(input({
    changedFiles: ['src/app/page.tsx'],
    checkRuns: appRuns(),
  }));
  assert.equal(result.state, 'success');
  assert.deepEqual(result.requiredContexts, ['diff-check', 'lint-and-build', 'test', 'e2e', 'account']);
});

test('a missing required context stays pending before the deadline', () => {
  assertState(evaluateRequiredChecks(input({
    changedFiles: ['src/app/page.tsx'],
    checkRuns: appRuns().filter(({ name }) => name !== 'account'),
  })), 'pending', 'missing:account');
});

test('a missing required context fails after the deadline', () => {
  assertState(evaluateRequiredChecks(input({
    changedFiles: ['src/app/page.tsx'],
    checkRuns: appRuns().filter(({ name }) => name !== 'account'),
    deadlineExpired: true,
  })), 'failure', 'missing:account');
});

for (const conclusion of ['failure', 'timed_out', 'action_required', 'startup_failure']) {
  test(`required conclusion ${conclusion} fails closed`, () => {
    assertState(evaluateRequiredChecks(input({
      changedFiles: ['src/app/page.tsx'],
      checkRuns: appRuns({ test: { conclusion } }),
    })), 'failure', `conclusion:test:${conclusion}`);
  });
}

test('cancelled required context fails closed', () => {
  assertState(evaluateRequiredChecks(input({
    changedFiles: ['src/app/page.tsx'],
    checkRuns: appRuns({ e2e: { conclusion: 'cancelled' } }),
  })), 'failure', 'conclusion:e2e:cancelled');
});

test('skipped required context fails closed, including a draft-required skip', () => {
  assertState(evaluateRequiredChecks(input({
    changedFiles: ['src/app/page.tsx'],
    checkRuns: appRuns({ account: { conclusion: 'skipped' } }),
  })), 'failure', 'conclusion:account:skipped');
});

test('an optional skipped context does not prevent success', () => {
  const result = evaluateRequiredChecks(input({
    checkRuns: [checkRun('diff-check'), checkRun('e2e', { id: 2, conclusion: 'skipped' })],
  }));
  assert.equal(result.state, 'success');
  assert.deepEqual(result.requiredContexts, ['diff-check']);
});

test('an obsolete event head fails closed', () => {
  assertState(evaluateRequiredChecks(input({ currentHeadSha: '3333333333333333333333333333333333333333' })), 'failure', 'obsolete-head');
});

test('a current base that is not an ancestor fails closed', () => {
  assertState(evaluateRequiredChecks(input({ baseIsAncestor: false })), 'failure', 'obsolete-base');
});

test('multiple protected PRs sharing one head fail closed', () => {
  assertState(evaluateRequiredChecks(input({ protectedPrCount: 2 })), 'failure', 'ambiguous-head');
});

test('an incomplete PR file listing fails closed', () => {
  assertState(evaluateRequiredChecks(input({
    reportedChangedFileCount: 3001,
    listedChangedFileCount: 3000,
  })), 'failure', 'incomplete-files');
});

test('a green check started before the latest base-target change is missing even if it completed later', () => {
  const result = evaluateRequiredChecks(input({
    evidenceNotBefore: '2026-09-10T00:02:00.000Z',
    checkRuns: [checkRun('diff-check', {
      started_at: '2026-09-10T00:01:00.000Z',
      completed_at: '2026-09-10T00:03:00.000Z',
    })],
  }));
  assertState(result, 'pending', 'missing:diff-check');
});

test('a success attached only to another SHA is missing', () => {
  assertState(evaluateRequiredChecks(input({
    checkRuns: [checkRun('diff-check', { head_sha: '3333333333333333333333333333333333333333' })],
  })), 'pending', 'missing:diff-check');
});

test('the newest rerun wins over an older success', () => {
  assertState(evaluateRequiredChecks(input({
    checkRuns: [checkRun('diff-check', { id: 10 }), checkRun('diff-check', { id: 11, conclusion: 'failure' })],
  })), 'failure', 'conclusion:diff-check:failure');
});

test('a newer queued rerun without timestamps overrides an older success', () => {
  const result = evaluateRequiredChecks(input({
    checkRuns: [
      checkRun('diff-check', { id: 1 }),
      checkRun('diff-check', {
        id: 2,
        status: 'queued',
        conclusion: null,
        started_at: null,
        created_at: null,
      }),
    ],
  }));
  assertState(result, 'pending', 'pending:diff-check:queued');
});

for (const status of ['queued', 'in_progress']) {
  test(`required context ${status} remains pending`, () => {
    assertState(evaluateRequiredChecks(input({
      checkRuns: [checkRun('diff-check', { status, conclusion: null })],
      deadlineExpired: true,
    })), 'pending', `pending:diff-check:${status}`);
  });
}

test('docs-only changes require only the always-emitted diff check', () => {
  const result = evaluateRequiredChecks(input({
    checkRuns: [checkRun('diff-check'), checkRun('e2e', { id: 2, conclusion: 'skipped' }), checkRun('account', { id: 3, conclusion: 'skipped' })],
  }));
  assert.equal(result.state, 'success');
  assert.deepEqual(result.requiredContexts, ['diff-check']);
});

test('closed PRs and wrong target branches fail closed', () => {
  assertState(evaluateRequiredChecks(input({ currentPrState: 'closed' })), 'failure', 'pr-not-open');
  assertState(evaluateRequiredChecks(input({ currentBaseRef: 'early-birds' })), 'failure', 'unexpected-base');
});

test('constituent workflows rerun their base-sensitive evidence after retargeting', () => {
  for (const path of ['ci.yml', 'e2e.yml', 'audio-boundary.yml']) {
    const workflow = readFileSync(resolve(ROOT, '.github', 'workflows', path), 'utf8');
    assert.match(workflow, /pull_request:\n(?:.|\n)*?types: \[[^\]]*edited[^\]]*\]/, path);
  }
});

test('delivery workflow executes only trusted base-side code on a hosted runner', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/delivery-gate.yml'), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI, E2E quality gates, Audio boundary\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/m);
  assert.doesNotMatch(workflow, /self-hosted|secrets\./);
  assert.equal(workflow.match(/uses: actions\/checkout@/g)?.length, 1);
  assert.doesNotMatch(workflow, /github\.head_ref|refs\/pull/);
  assert.doesNotMatch(workflow, /checkout[^\n]*event_head|node[^\n]*event_head/);
  assert.match(workflow, /ref:.*event_name == 'pull_request_target'.*pull_request\.base\.sha.*repository\.default_branch/);
  assert.doesNotMatch(workflow, /ref:.*github\.sha/);
  assert.match(workflow, /previous_filename/);
  assert.match(workflow, /EVENT_ACTION.*github\.event\.action/);
  assert.match(workflow, /EVENT_ACTION" = closed/);
  assert.match(workflow, /pulls\?state=open/);
  assert.doesNotMatch(workflow, /commits\/\$event_head\/pulls/);
  assert.match(workflow, /\.head\.sha == \$head/);
  assert.match(workflow, /issues\/\$pr_number\/timeline/);
  assert.match(workflow, /evidenceNotBefore.*evidence_not_before/);
  assert.match(workflow, /--slurpfile changedFiles/);
  assert.match(workflow, /check_runs\[\] \| \{id, name, head_sha, status, conclusion/);
  assert.match(workflow, /--slurpfile checkRuns/);
  assert.doesNotMatch(workflow, /--argjson (?:changedFiles|checkRuns)/);
  assert.match(workflow, /protectedPrCount.*protected_pr_count/);
  assert.match(workflow, /reportedChangedFileCount.*reported_changed_file_count/);
  assert.match(workflow, /listedChangedFileCount.*listed_changed_file_count/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'.*shadow.*required/);
  assert.match(workflow, /pull_request\.head\.sha.*workflow_run\.head_sha/);
  assert.match(workflow, /case "\$expected_base" in\s+main\|release/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /checks: read/);
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /delivery-gate:\n\s+name: Trusted delivery monitor/);
  assert.match(workflow, /delivery-gate-shadow/);
});
