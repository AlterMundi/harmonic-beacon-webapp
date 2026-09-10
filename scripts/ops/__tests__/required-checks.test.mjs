import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateRequiredChecks } from '../../ci/required-checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const MERGE = '4444444444444444444444444444444444444444';
const ACTIONS_APP_ID = 15368;

function workflowIdentity(name, id, overrides = {}) {
  const workflow = ['e2e', 'account'].includes(name)
    ? { name: 'E2E quality gates', path: '.github/workflows/e2e.yml' }
    : name === 'frozen-audio-paths'
      ? { name: 'Audio boundary', path: '.github/workflows/audio-boundary.yml' }
      : { name: 'CI', path: '.github/workflows/ci.yml' };
  const suiteId = 1000 + id;
  return {
    id: 2000 + id,
    check_suite_id: suiteId,
    run_attempt: 1,
    event: 'pull_request',
    head_sha: HEAD,
    run_started_at: '2026-09-10T00:01:00.000Z',
    pull_requests: [{ number: 534, head: { sha: HEAD }, base: { ref: 'main', sha: BASE } }],
    ...workflow,
    ...overrides,
  };
}

function checkRun(name, overrides = {}) {
  const id = overrides.id ?? 1;
  const suiteId = 1000 + id;
  return {
    id,
    name,
    head_sha: overrides.head_sha ?? HEAD,
    status: overrides.status ?? 'completed',
    conclusion: overrides.conclusion === undefined ? 'success' : overrides.conclusion,
    completed_at: Object.hasOwn(overrides, 'completed_at') ? overrides.completed_at : null,
    started_at: Object.hasOwn(overrides, 'started_at') ? overrides.started_at : '2026-09-10T00:01:00.000Z',
    created_at: Object.hasOwn(overrides, 'created_at') ? overrides.created_at : '2026-09-10T00:01:00.000Z',
    app: overrides.app ?? { id: ACTIONS_APP_ID, slug: 'github-actions' },
    check_suite: overrides.check_suite ?? {
      id: suiteId,
      head_sha: overrides.head_sha ?? HEAD,
      app: { id: ACTIONS_APP_ID, slug: 'github-actions' },
    },
    workflow_run: Object.hasOwn(overrides, 'workflow_run') ? overrides.workflow_run : workflowIdentity(name, id),
  };
}

function input(overrides = {}) {
  const value = {
    prNumber: 534,
    expectedBaseRef: 'main',
    eventHeadSha: HEAD,
    eventBaseSha: BASE,
    currentPrNumber: 534,
    currentPrState: 'open',
    currentHeadSha: HEAD,
    currentBaseSha: BASE,
    currentBaseRef: 'main',
    currentMergeSha: MERGE,
    evaluatorBaseSha: BASE,
    baseIsAncestor: true,
    evidenceNotBefore: '2026-09-10T00:00:00.000Z',
    protectedPrCount: 1,
    reportedChangedFileCount: 1,
    listedChangedFileCount: 1,
    changedFiles: ['docs/ops/example.md'],
    checkRuns: [checkRun('diff-check')],
    checkSnapshotStable: true,
    deadlineExpired: false,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'reportedCheckRunCount')) {
    value.reportedCheckRunCount = new Set(value.checkRuns.map(({ id }) => id)).size;
  }
  return value;
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

test('rejects a same-name success emitted by a foreign check App', () => {
  assertState(evaluateRequiredChecks(input({
    checkRuns: [checkRun('diff-check', { app: { id: 999999, slug: 'attacker-app' } })],
  })), 'failure', 'untrusted:diff-check');
});

test('rejects a same-name success from the wrong workflow or pull request identity', () => {
  const wrongWorkflow = checkRun('diff-check', {
    workflow_run: workflowIdentity('diff-check', 1, { path: '.github/workflows/attacker.yml' }),
  });
  assertState(evaluateRequiredChecks(input({ checkRuns: [wrongWorkflow] })), 'failure', 'untrusted:diff-check');

  const wrongPr = checkRun('diff-check', {
    workflow_run: workflowIdentity('diff-check', 1, {
      pull_requests: [{ number: 999, head: { sha: HEAD }, base: { ref: 'main', sha: BASE } }],
    }),
  });
  assertState(evaluateRequiredChecks(input({ checkRuns: [wrongPr] })), 'failure', 'untrusted:diff-check');
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

test('a retargeted base or evaluator from another base fails closed', () => {
  assertState(evaluateRequiredChecks(input({
    eventBaseSha: '3333333333333333333333333333333333333333',
  })), 'failure', 'retargeted-base');
  assertState(evaluateRequiredChecks(input({
    evaluatorBaseSha: '3333333333333333333333333333333333333333',
  })), 'failure', 'wrong-evaluator-base');
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
    checkRuns: [checkRun('diff-check', { id: 10 }), checkRun('diff-check', {
      id: 11,
      conclusion: 'failure',
      started_at: '2026-09-10T00:02:00.000Z',
      created_at: '2026-09-10T00:02:00.000Z',
      workflow_run: workflowIdentity('diff-check', 11, { run_started_at: '2026-09-10T00:02:00.000Z' }),
    })],
  })), 'failure', 'conclusion:diff-check:failure');
});

test('a later workflow timestamp wins even when its check and workflow IDs are lower', () => {
  const olderSuccess = checkRun('diff-check', {
    id: 100,
    workflow_run: workflowIdentity('diff-check', 100, { id: 900, run_started_at: '2026-09-10T00:01:00.000Z' }),
  });
  const newerQueued = checkRun('diff-check', {
    id: 99,
    status: 'queued',
    conclusion: null,
    started_at: null,
    created_at: '2026-09-10T00:02:00.000Z',
    workflow_run: workflowIdentity('diff-check', 99, { id: 899, run_started_at: '2026-09-10T00:02:00.000Z' }),
  });
  assertState(evaluateRequiredChecks(input({ checkRuns: [olderSuccess, newerQueued] })), 'pending', 'pending:diff-check:queued');
});

test('foreign checks without Actions workflow metadata are ordered deterministically by check timestamp', () => {
  const trusted = checkRun('diff-check', {
    id: 50,
    workflow_run: workflowIdentity('diff-check', 50, { run_started_at: '2026-09-10T00:01:00.000Z' }),
  });
  const foreignNewer = checkRun('diff-check', {
    id: 40,
    created_at: '2026-09-10T00:02:00.000Z',
    started_at: '2026-09-10T00:02:00.000Z',
    app: { id: 999999, slug: 'attacker-app' },
    workflow_run: null,
  });
  for (const checkRuns of [[trusted, foreignNewer], [foreignNewer, trusted]]) {
    assertState(evaluateRequiredChecks(input({ checkRuns })), 'failure', 'untrusted:diff-check');
  }

  const foreignOlder = { ...foreignNewer, created_at: '2026-09-09T23:59:00.000Z', started_at: '2026-09-09T23:59:00.000Z' };
  for (const checkRuns of [[trusted, foreignOlder], [foreignOlder, trusted]]) {
    assertState(evaluateRequiredChecks(input({ checkRuns })), 'success');
  }
});

test('a higher rerun attempt wins within one workflow run', () => {
  const suite = { id: 700, head_sha: HEAD, app: { id: ACTIONS_APP_ID, slug: 'github-actions' } };
  const older = checkRun('diff-check', {
    id: 10,
    check_suite: suite,
    workflow_run: workflowIdentity('diff-check', 10, { id: 800, check_suite_id: 700, run_attempt: 1 }),
  });
  const rerun = checkRun('diff-check', {
    id: 9,
    status: 'queued',
    conclusion: null,
    check_suite: suite,
    workflow_run: workflowIdentity('diff-check', 9, { id: 800, check_suite_id: 700, run_attempt: 2 }),
  });
  assertState(evaluateRequiredChecks(input({ checkRuns: [older, rerun] })), 'pending', 'pending:diff-check:queued');
});

test('conflicting duplicate check IDs fail independent of response order', () => {
  const success = checkRun('diff-check', { id: 77 });
  const queued = checkRun('diff-check', { id: 77, status: 'queued', conclusion: null });
  for (const checkRuns of [[success, queued], [queued, success]]) {
    assertState(evaluateRequiredChecks(input({ checkRuns, reportedCheckRunCount: 1 })), 'failure', 'conflicting-check-run:77');
  }
});

test('incomplete or unstable paginated check snapshots cannot succeed', () => {
  assertState(evaluateRequiredChecks(input({ reportedCheckRunCount: 2 })), 'failure', 'incomplete-check-runs');
  assertState(evaluateRequiredChecks(input({ checkSnapshotStable: false })), 'pending', 'unstable-check-snapshot');
  assertState(evaluateRequiredChecks(input({ checkSnapshotStable: false, deadlineExpired: true })), 'failure', 'unstable-check-snapshot');
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
  assert.match(workflow, /id: target/);
  assert.match(workflow, /base_sha=.*\.base\.sha/);
  assert.match(workflow, /merge_sha=.*\.merge_commit_sha/);
  assert.match(workflow, /ref: \$\{\{ steps\.target\.outputs\.base_sha \}\}/);
  assert.match(workflow, /evaluator_base=.*git rev-parse HEAD/);
  assert.match(workflow, /evaluatorBaseSha.*evaluator_base/);
  assert.match(workflow, /currentMergeSha.*current_merge/);
  assert.match(workflow, /final_pr=.*repos\/\$REPOSITORY\/pulls\/\$pr_number/);
  assert.match(workflow, /final_merge=.*\.merge_commit_sha/);
  assert.match(workflow, /post_status success "\$description" "\$final_merge"/);
  assert.doesNotMatch(workflow, /post_status success "\$description" "\$event_head"/);
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
  assert.match(workflow, /check_suite_ids=.*check_suite\.id/);
  assert.match(workflow, /check-suites\/\$suite_id/);
  assert.match(workflow, /--argjson suites/);
  assert.match(workflow, /app: \{id: \$check\.app\.id, slug: \$check\.app\.slug\}/);
  assert.match(workflow, /check_suite: \(if \$suite == null/);
  assert.match(workflow, /workflow_run: \(if \$workflow == null/);
  assert.match(workflow, /check_suite_id: \$workflow\.check_suite_id/);
  assert.match(workflow, /pull_requests: \$workflow\.pull_requests/);
  assert.match(workflow, /--slurpfile checkRuns/);
  assert.match(workflow, /check_pages_a=.*fetch_check_pages/);
  assert.match(workflow, /check_pages_b=.*fetch_check_pages/);
  assert.match(workflow, /final_check_pages=.*fetch_check_pages/);
  assert.match(workflow, /canonical_check_snapshot.*final_check_pages/);
  assert.match(workflow, /final_timeline="[\s\S]{0,200}issues\/\$pr_number\/timeline/);
  assert.match(workflow, /final_evidence_not_before/);
  assert.match(workflow, /reportedCheckRunCount.*reported_check_run_count/);
  assert.match(workflow, /checkSnapshotStable.*check_snapshot_stable/);
  assert.match(workflow, /total_count/);
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
