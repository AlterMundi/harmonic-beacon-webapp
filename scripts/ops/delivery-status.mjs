import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// Diagnostic only. The protected evaluator remains the admission authority.
export async function github(args) {
  const { stdout } = await execute('gh', args, {
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  return JSON.parse(stdout);
}

function identity(pr) {
  return [pr.number, pr.state, pr.draft, pr.head?.sha, pr.base?.sha,
    pr.base?.ref, pr.merge_commit_sha];
}

function short(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 160) : null;
}

function runLink(value, repo) {
  if (typeof value !== 'string') return null;
  const prefix = `https://github.com/${repo}/actions/runs/`;
  return value.startsWith(prefix) && /^\d+(?:\/job\/\d+)?$/.test(value.slice(prefix.length)) ? value : null;
}

function selectStatuses(pages, context, repo) {
  const all = pages.flat();
  if (!all.every(row => Number.isSafeInteger(row.id) && row.id > 0 && typeof row.context === 'string')) {
    throw new Error('invalid status response');
  }
  const status = all.filter(row => row.context === context).sort((a, b) => b.id - a.id)[0];
  return status ? {
    id: status.id, state: short(status.state),
    run: runLink(status.target_url, repo),
  } : { state: 'missing' };
}

function selectChecks(pages, repo) {
  const rows = pages.flatMap(page => page.check_runs ?? []);
  const totals = new Set(pages.map(page => page.total_count));
  if (totals.size !== 1 || !totals.has(new Set(rows.map(row => row.id)).size)) {
    throw new Error('incomplete check response');
  }
  // Include every attempt; two jobs with the same name can disagree. Do not
  // convert these observations into a verdict about required/trusted checks.
  return rows.map(row => ({
    id: row.id, name: short(row.name), state: short(row.status),
    conclusion: short(row.conclusion), run: runLink(row.details_url, repo),
  }));
}

export async function inspectDelivery({ repo, pr }, read = github) {
  if (!REPOSITORY.test(repo) || !Number.isSafeInteger(pr) || pr <= 0) throw new Error('invalid repository or PR');
  const prefix = `repos/${repo}`;
  const api = (path) => read(['api', '--method', 'GET', `${prefix}/${path}`]);
  const pages = (path) => read(['api', '--method', 'GET', '--paginate', '--slurp', `${prefix}/${path}`]);
  const initial = await api(`pulls/${pr}`);
  if (initial.number !== pr || !SHA.test(initial.head?.sha ?? '') || !SHA.test(initial.base?.sha ?? '')) {
    throw new Error('invalid PR identity');
  }
  const merge = SHA.test(initial.merge_commit_sha ?? '') ? initial.merge_commit_sha : null;
  const specs = [
    ['protection', () => api(`branches/${encodeURIComponent(initial.base.ref)}/protection`)],
    ['review', () => read(['pr', 'view', String(pr), '--repo', repo, '--json', 'reviewDecision,mergeStateStatus'])],
    ['checks', () => pages(`commits/${initial.head.sha}/check-runs?per_page=100&filter=all`)],
    ['headStatuses', () => pages(`commits/${initial.head.sha}/statuses?per_page=100`)],
    ['mergeStatuses', () => merge && initial.state === 'open'
      ? pages(`commits/${merge}/statuses?per_page=100`) : Promise.resolve(null)],
  ];
  const results = await Promise.allSettled(specs.map(([, readSource]) => readSource()));
  const sources = {};
  const unknown = [];
  if (initial.state === 'open' && merge === null) unknown.push('mergeIdentity');
  results.forEach((result, index) => {
    const name = specs[index][0];
    if (result.status === 'fulfilled') sources[name] = result.value;
    else unknown.push(name); // Never include raw errors: gh may echo server bodies.
  });
  const final = await api(`pulls/${pr}`);
  const stable = JSON.stringify(identity(initial)) === JSON.stringify(identity(final));
  const contexts = sources.protection?.required_status_checks?.checks?.map(item => ({
    context: short(item.context), appId: item.app_id,
  })) ?? null;
  if (!contexts) unknown.push('requiredContexts');
  const observe = (name, fn) => {
    if (!(name in sources)) return null;
    try { return fn(sources[name]); } catch { unknown.push(name); return null; }
  };
  const checks = observe('checks', value => selectChecks(value, repo));
  const gate = {
    head: observe('headStatuses', value => selectStatuses(value, 'delivery-gate', repo)),
    merge: observe('mergeStatuses', value => value === null ? null : selectStatuses(value, 'delivery-gate', repo)),
  };
  const next = [];
  if (!stable) next.push('PR changed during inspection: refresh before acting.');
  if (unknown.length) next.push('Some sources are unavailable: resolve the named unknowns before an admission decision.');
  if (initial.state !== 'open') next.push('PR is closed: inspect the actual integration/deployment separately.');
  else {
    if (initial.draft) next.push('Draft: finish the batch before requesting release qualification.');
    if (gate.merge?.state === 'missing') next.push('Current merge has no delivery-gate: inspect the protected evaluator before rerunning product tests.');
    if (['failure', 'error'].includes(gate.merge?.state)) next.push('Read the gate run reason; fix the failed check or evidence binding.');
    if (gate.merge?.state === 'pending') next.push('Gate pending: inspect its run and outstanding checks.');
    if (sources.review?.reviewDecision !== 'APPROVED') next.push('GitHub approval is absent, unavailable, or changes are requested.');
    if (checks?.some(check => ['failure', 'timed_out'].includes(check.conclusion))) next.push('Failed check observations exist: identify the current required attempt before diagnosing.');
  }
  return {
    schemaVersion: 1, observedAt: new Date().toISOString(), repo, pr,
    purpose: 'read-only diagnostic; not permission to merge or deploy',
    stable, state: initial.state, draft: initial.draft,
    head: initial.head.sha, base: initial.base.sha, baseRef: initial.base.ref, merge,
    reviewDecision: short(sources.review?.reviewDecision),
    mergeStateStatus: short(sources.review?.mergeStateStatus),
    requiredContexts: contexts, gate, checks, unknown: [...new Set(unknown)], next,
    production: 'not-inspected',
  };
}

export async function main(args) {
  let repo = 'AlterMundi/harmonic-beacon-webapp';
  let pr;
  let json = false;
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--repo') repo = args[++i] ?? '';
      else if (args[i] === '--pr') pr = Number(args[++i]);
      else if (args[i] === '--json') json = true;
      else if (['--help', '-h'].includes(args[i])) {
        console.log('Usage: node scripts/hb.mjs delivery-status --pr NUMBER [--repo OWNER/REPO] [--json]');
        return 0;
      } else throw new Error('invalid argument');
    }
    const report = await inspectDelivery({ repo, pr });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${repo} #${pr}: ${report.state}; review=${report.reviewDecision ?? 'unknown'}; merge=${report.mergeStateStatus ?? 'unknown'}`);
      console.log(`head=${report.head}\nbase=${report.base}\nmerge=${report.merge ?? 'unknown'}`);
      console.log(`delivery-gate head=${report.gate.head?.state ?? 'unknown'} merge=${report.gate.merge?.state ?? 'unknown'}`);
      for (const step of report.next) console.log(step);
      if (report.unknown.length) console.log(`Unknown sources: ${report.unknown.join(', ')}`);
      console.log('Diagnostic only. Production was not inspected.');
    }
    return report.stable && report.unknown.length === 0 ? 0 : 2;
  } catch {
    console.error('delivery-status: unable to read a complete PR identity; verify arguments, GitHub access and connectivity');
    return 2;
  }
}
