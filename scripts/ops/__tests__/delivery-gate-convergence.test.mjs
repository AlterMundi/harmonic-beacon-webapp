import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const DISPATCHER_PATH = resolve(ROOT, '.github/workflows/delivery-gate-dispatch.yml');
const AUTHORITY_PATH = resolve(ROOT, '.github/workflows/delivery-gate.yml');
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const MERGE = '3333333333333333333333333333333333333333';

function workflowScript(path) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('          set -euo pipefail');
  assert.ok(start >= 0, `${path} must contain its shell body`);
  return source.slice(start).split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
}

function authorityScript(baseSha) {
  const source = readFileSync(AUTHORITY_PATH, 'utf8');
  const start = source.lastIndexOf('          set -euo pipefail');
  assert.ok(start >= 0, 'authority evaluation shell must be present');
  return source.slice(start).split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
    .replaceAll('${{ steps.target.outputs.base_sha }}', baseSha);
}

function evaluateAuthority({ state, drift = false, partial = false, compareFailure = false }) {
  const temp = mkdtempSync(join(tmpdir(), 'delivery-gate-authority-'));
  const fakeGh = join(temp, 'gh');
  const fakeNode = join(temp, 'node');
  const log = join(temp, 'gh.log');
  const prReads = join(temp, 'pr-reads');
  const summary = join(temp, 'summary');
  const base = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).stdout.trim();
  const changedMerge = '5555555555555555555555555555555555555555';
  writeFileSync(fakeGh, `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"--method POST repos/AlterMundi/harmonic-beacon-webapp/statuses/"*)
    printf '%s\\n' "$*" >> "$GH_LOG"
    ;;
  *"pulls?state=open"*)
    printf '%s\\n' '[[{"number":534,"state":"open","head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${base}"}}]]'
    ;;
  *"pulls/534/files"*)
    printf '%s\\n' '[[{"filename":"docs/example.md"}]]'
    ;;
  *"pulls/534"*)
    reads=0; [ ! -f "$PR_READS" ] || reads="$(cat "$PR_READS")"; reads=$((reads + 1)); printf '%s' "$reads" > "$PR_READS"
    merge='${MERGE}'; if [ "${drift ? 'yes' : 'no'}" = yes ] && [ "$reads" -ge 3 ]; then merge='${changedMerge}'; fi
    printf '{"number":534,"state":"open","created_at":"2026-09-20T10:00:00Z","changed_files":1,"merge_commit_sha":"%s","head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${base}"}}\\n' "$merge"
    ;;
  *"issues/534/timeline"*) printf '%s\\n' '[[]]' ;;
  *"commits/${HEAD}/check-runs"*)
    if [ "${partial ? 'yes' : 'no'}" = yes ]; then exit 1; fi
    printf '%s\\n' '[{"total_count":0,"check_runs":[]}]'
    ;;
  *"actions/runs?head_sha=${HEAD}"*) printf '%s\\n' '[{"total_count":0,"workflow_runs":[]}]' ;;
  *"compare/${base}...${HEAD}"*)
    if [ "${compareFailure ? 'yes' : 'no'}" = yes ]; then exit 1; fi
    printf '%s\\n' 'ahead'
    ;;
  *) printf 'unexpected gh invocation: %s\\n' "$*" >&2; exit 1 ;;
esac
`);
  writeFileSync(fakeNode, `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = scripts/ci/required-checks.mjs ]
case "$EVALUATION_STATE" in
  success) printf '%s\\n' '{"state":"success","description":"all exact checks passed","reasons":[]}' ;;
  failure) printf '%s\\n' '{"state":"failure","description":"delivery gate failed: conclusion:test:failure","reasons":["conclusion:test:failure"]}' ;;
  pending) printf '%s\\n' '{"state":"pending","description":"waiting for 1 required check","reasons":["pending:test:in_progress"]}' ;;
  *) exit 1 ;;
esac
`);
  chmodSync(fakeGh, 0o755);
  chmodSync(fakeNode, 0o755);
  try {
    const result = spawnSync('bash', ['-c', authorityScript(base)], {
      encoding: 'utf8', cwd: ROOT,
      env: {
        ...process.env, PATH: `${temp}:${process.env.PATH}`,
        GH_LOG: log, PR_READS: prReads, EVALUATION_STATE: state,
        REPOSITORY: 'AlterMundi/harmonic-beacon-webapp', PR_NUMBER: '534', EXPECTED_BASE: 'main',
        EVENT_HEAD: HEAD, EVENT_BASE: base, INITIAL_MERGE: MERGE, CONTEXT: 'delivery-gate',
        RUN_URL: 'https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/9002',
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    const statuses = readFileSync(log, { encoding: 'utf8', flag: 'a+' }).split('\n').filter(Boolean);
    return { result, statuses, changedMerge };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function reconcile({
  gateCreated = '', gateState = 'success', gateRunState = 'completed',
  workflowUpdated = '2026-09-20T12:00:00Z', workflowStatus = 'completed', trustedGate = true,
  gateStatuses,
} = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'delivery-gate-reconcile-'));
  const fakeGh = join(temp, 'gh');
  const log = join(temp, 'gh.log');
  const defaultGate = gateCreated ? [{
    id: 9001,
    context: 'delivery-gate', state: gateState, created_at: gateCreated,
    creator: { login: trustedGate ? 'github-actions[bot]' : 'untrusted' },
    target_url: 'https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/9001',
  }] : [];
  const statusPages = JSON.stringify([gateStatuses ?? defaultGate]);
  writeFileSync(fakeGh, `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"pulls?state=open"*)
    printf '%s\\n' '[[{"number":534,"state":"open","head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${BASE}"}}]]'
    ;;
  *"pulls/534"*)
    printf '%s\\n' '{"number":534,"state":"open","merge_commit_sha":"${MERGE}","head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${BASE}"}}'
    ;;
  *"commits/${MERGE}/statuses"*)
    printf '%s\\n' '${statusPages}'
    ;;
  *"actions/runs?head_sha=${HEAD}"*)
    printf '%s\\n' '[{"total_count":1,"workflow_runs":[{"path":".github/workflows/ci.yml","status":"${workflowStatus}","updated_at":"${workflowUpdated}"}]}]'
    ;;
  *"actions/runs/9001"*)
    printf '%s\\n' '${gateRunState}'
    ;;
  *"actions/workflows/delivery-gate.yml/dispatches"*)
    printf '%s\\n' "$*" >> "$GH_LOG"
    ;;
  *)
    printf 'unexpected gh invocation: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
  chmodSync(fakeGh, 0o755);
  try {
    const result = spawnSync('bash', ['-c', workflowScript(DISPATCHER_PATH)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${temp}:${process.env.PATH}`,
        GH_LOG: log,
        REPOSITORY: 'AlterMundi/harmonic-beacon-webapp',
        EVENT_NAME: 'schedule',
        EVENT_ACTION: '',
        INPUT_PR_NUMBER: '',
        WORKFLOW_HEAD: '',
        WORKFLOW_RUN_ID: '',
        WORKFLOW_RUN_ATTEMPT: '',
      },
    });
    const calls = result.status === 0
      ? readFileSync(log, { encoding: 'utf8', flag: 'a+' }).trim().split('\n').filter(Boolean)
      : [];
    return { result, calls };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('authority is a short one-shot evaluation with bounded API retry', () => {
  const workflow = readFileSync(AUTHORITY_PATH, 'utf8');
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /for attempt in 0; do/);
  assert.doesNotMatch(workflow, /seq 0 95|sleep 60|timeout-minutes: 100/);
  assert.match(workflow, /for attempt in 1 2 3; do/);
  assert.match(workflow, /post_status failure "\$description" "\$current_merge"\n\s+exit 1/);
  assert.match(workflow, /post_status pending "\$description" "\$current_merge"\n\s+exit 0/);
  assert.match(workflow, /final_evidence="\$\(fetch_evidence_snapshot\)"/);
});

test('authority green publishes success on the unchanged current merge and exits', () => {
  const { result, statuses } = evaluateAuthority({ state: 'success' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statuses.length, 2);
  assert.match(statuses[0], new RegExp(`statuses/${MERGE}.*state=pending`));
  assert.match(statuses[1], new RegExp(`statuses/${MERGE}.*state=success`));
});

test('authority terminal failure publishes failure and exits without monitoring', () => {
  const { result, statuses } = evaluateAuthority({ state: 'failure' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(statuses.length, 2);
  assert.match(statuses[1], /state=failure/);
});

test('authority pending publishes pending and terminates successfully', () => {
  const { result, statuses } = evaluateAuthority({ state: 'pending' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statuses.length, 2);
  assert.ok(statuses.every((line) => line.includes('state=pending')));
});

test('authority identity drift cannot publish success', () => {
  const { result, statuses } = evaluateAuthority({ state: 'success', drift: true });
  assert.equal(result.status, 1);
  assert.equal(statuses.some((line) => line.includes('state=success')), false);
});

test('partial API evidence leaves pending and cannot publish success', () => {
  const { result, statuses } = evaluateAuthority({ state: 'success', partial: true });
  assert.notEqual(result.status, 0);
  assert.equal(statuses.length, 1);
  assert.match(statuses[0], /state=pending/);
});

test('compare API exhaustion leaves pending instead of publishing obsolete-base failure', () => {
  const { result, statuses } = evaluateAuthority({ state: 'success', compareFailure: true });
  assert.notEqual(result.status, 0);
  assert.equal(statuses.length, 1);
  assert.match(statuses[0], /state=pending/);
});

test('every result is rebound to the live PR identity before its status write', () => {
  const workflow = readFileSync(AUTHORITY_PATH, 'utf8');
  assert.match(workflow, /post_status pending[^\n]+\$current_merge[\s\S]+initial_merge=.*\.merge_commit_sha[\s\S]+\[ "\$initial_merge" = "\$current_merge" \]/);
  assert.match(workflow, /if \[ "\$state" = failure \]; then[\s\S]+final_pr=.*pulls\/\$pr_number[\s\S]+\.merge_commit_sha[\s\S]+post_status failure/);
  assert.match(workflow, /final_evidence_not_before[\s\S]+canonical_evidence_snapshot[\s\S]+post_status success/);
});

test('rerun starts, completions, and PR identity changes all wake the bounded evaluator', () => {
  const dispatcher = readFileSync(DISPATCHER_PATH, 'utf8');
  assert.match(dispatcher, /types: \[requested, in_progress, completed\]/);
  assert.match(dispatcher, /types: \[opened, synchronize, reopened, edited, ready_for_review, labeled, unlabeled, closed\]/);
  assert.match(dispatcher, /schedule:\n\s+- cron:/);
  assert.match(dispatcher, /group: delivery-gate-dispatch-[^\n]+workflow_run\.id/);
  assert.match(dispatcher, /cancel-in-progress: false/);
  assert.match(dispatcher, /name: Dispatch exact-base delivery authority\n\s+runs-on: ubuntu-24\.04\n\s+timeout-minutes: 10/);
  assert.doesNotMatch(dispatcher, /statuses: write|repos\/\$REPOSITORY\/statuses/);
  assert.match(dispatcher, /creator\.login == "github-actions\[bot\]"/);
  assert.match(dispatcher, /actions\/runs\/"/);
});

test('reconciliation dispatches when the regenerated merge has no aggregate status', () => {
  const { result, calls } = reconcile();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /actions\/workflows\/delivery-gate\.yml\/dispatches/);
  assert.match(calls[0], /inputs\[status_context\]=delivery-gate/);
});

test('reconciliation dispatches when constituent evidence is newer than the aggregate', () => {
  const { result, calls } = reconcile({ gateCreated: '2026-09-20T11:00:00Z' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
});

test('reconciliation leaves a current aggregate alone', () => {
  const { result, calls } = reconcile({
    gateCreated: '2026-09-20T13:00:00Z',
    workflowUpdated: '2026-09-20T12:00:00Z',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, []);
});

test('reconciliation selects the greatest status id when transitions share one timestamp', () => {
  const timestamp = '2026-09-20T13:00:00Z';
  const status = (id, state) => ({
    id, context: 'delivery-gate', state, created_at: timestamp,
    creator: { login: 'github-actions[bot]' },
    target_url: 'https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/9001',
  });
  const { result, calls } = reconcile({
    gateStatuses: [status(9002, 'success'), status(9001, 'pending')],
    workflowUpdated: '2026-09-20T12:00:00Z',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, []);
});

test('reconciliation recovers a stranded pending status after its evaluator and constituents stop', () => {
  const { result, calls } = reconcile({
    gateCreated: '2026-09-20T13:00:00Z',
    gateState: 'pending',
    gateRunState: 'completed',
    workflowUpdated: '2026-09-20T12:00:00Z',
    workflowStatus: 'completed',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
});

test('reconciliation does not duplicate a pending evaluation while evidence is still running', () => {
  const { result, calls } = reconcile({
    gateCreated: '2026-09-20T13:00:00Z',
    gateState: 'pending',
    gateRunState: 'completed',
    workflowUpdated: '2026-09-20T12:00:00Z',
    workflowStatus: 'in_progress',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, []);
});

test('reconciliation does not accept a same-name status from an untrusted writer', () => {
  const { result, calls } = reconcile({
    gateCreated: '2026-09-20T13:00:00Z',
    workflowUpdated: '2026-09-20T12:00:00Z',
    trustedGate: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
});

test('one malformed PR is reported without starving later reconciliation', () => {
  const temp = mkdtempSync(join(tmpdir(), 'delivery-gate-isolation-'));
  const fakeGh = join(temp, 'gh');
  const log = join(temp, 'gh.log');
  writeFileSync(fakeGh, `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"pulls?state=open"*)
    printf '%s\\n' '[[{"number":533,"base":{"ref":"main"}},{"number":534,"base":{"ref":"main"}}]]'
    ;;
  *"pulls/533"*)
    printf '%s\\n' '{"number":533,"state":"open","merge_commit_sha":null,"head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${BASE}"}}'
    ;;
  *"pulls/534"*)
    printf '%s\\n' '{"number":534,"state":"open","merge_commit_sha":"${MERGE}","head":{"sha":"${HEAD}"},"base":{"ref":"main","sha":"${BASE}"}}'
    ;;
  *"commits/${MERGE}/statuses"*) printf '%s\\n' '[[]]' ;;
  *"actions/runs?head_sha=${HEAD}"*) printf '%s\\n' '[{"total_count":0,"workflow_runs":[]}]' ;;
  *"actions/workflows/delivery-gate.yml/dispatches"*) printf '%s\\n' "$*" >> "$GH_LOG" ;;
  *) printf 'unexpected gh invocation: %s\\n' "$*" >&2; exit 1 ;;
esac
`);
  chmodSync(fakeGh, 0o755);
  try {
    const result = spawnSync('bash', ['-c', workflowScript(DISPATCHER_PATH)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${temp}:${process.env.PATH}`,
        GH_LOG: log,
        REPOSITORY: 'AlterMundi/harmonic-beacon-webapp',
        EVENT_NAME: 'schedule', EVENT_ACTION: '', INPUT_PR_NUMBER: '', WORKFLOW_HEAD: '',
        WORKFLOW_RUN_ID: '', WORKFLOW_RUN_ATTEMPT: '',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reconciliation failed for pr=533/);
    assert.match(readFileSync(log, 'utf8'), /inputs\[pr_number\]=534/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
