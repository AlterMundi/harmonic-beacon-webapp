#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CATALOG = resolve(REPO_ROOT, 'deploy/platform-services.json');
const LEVEL_ORDER = { ok: 0, skipped: 0, warning: 1, error: 2 };

function result(level, check, detail, extra = {}) {
  return { level, check, detail, ...extra };
}

export function inspectLocalRoutes(service, pathExists = (path) => existsSync(resolve(REPO_ROOT, path))) {
  return [...service.localPaths, ...service.workflows, ...service.recoveryDocs].map((path) =>
    result(pathExists(path) ? 'ok' : 'error', `${service.id}.file`, path));
}

export async function inspectBranchSource(service, source, pathExists) {
  const paths = [...source.paths, ...source.workflows, ...source.recoveryDocs];
  const results = [];
  for (const path of paths) {
    const exists = await pathExists(path, source.ref);
    results.push(result(exists ? 'ok' : 'error', `${service.id}.branch-file`, `${source.ref}:${path}`));
  }
  return results;
}

export function evaluateDeliveryProtection(policy, branch, protection) {
  if (!protection) return { ok: false, detail: `${branch}: branch protection unavailable` };
  const exactCheck = (protection.required_status_checks?.checks ?? []).find(
    ({ context, app_id: appId }) => context === policy.requiredContext && appId === policy.requiredAppId,
  );
  if (!exactCheck) {
    return { ok: false, detail: `${branch}: ${policy.requiredContext} is not bound to exact Actions App ${policy.requiredAppId}` };
  }
  const reviews = protection.required_pull_request_reviews;
  if (policy.requirePullRequest && !reviews) {
    return { ok: false, detail: `${branch}: pull requests are not required` };
  }
  if (policy.allowForcePushes === false && protection.allow_force_pushes?.enabled !== false) {
    return { ok: false, detail: `${branch}: force pushes are enabled` };
  }
  if (policy.requireCodeOwnerReviews && reviews?.require_code_owner_reviews !== true) {
    return { ok: false, detail: `${branch}: code-owner review is not required` };
  }
  if ((reviews?.required_approving_review_count ?? 0) < policy.requiredApprovingReviewCount) {
    return { ok: false, detail: `${branch}: branch does not require at least ${policy.requiredApprovingReviewCount} approving review(s)` };
  }
  if (policy.dismissStaleReviews && reviews?.dismiss_stale_reviews !== true) {
    return { ok: false, detail: `${branch}: stale reviews are not dismissed` };
  }
  if (policy.requireLastPushApproval && reviews?.require_last_push_approval !== true) {
    return { ok: false, detail: `${branch}: last push approval is not required` };
  }
  if (policy.allowDeletions === false && protection.allow_deletions?.enabled !== false) {
    return { ok: false, detail: `${branch}: branch deletion is enabled` };
  }
  if (policy.requireUpToDate && protection.required_status_checks?.strict !== true) {
    return { ok: false, detail: `${branch}: base updates do not require an up-to-date head` };
  }
  return {
    ok: true,
    detail: `${branch}: protected with ${policy.requiredApprovingReviewCount} current-push/code-owner approval, stale dismissal, strict base, no force pushes/deletion and ${policy.requiredContext} from Actions App ${policy.requiredAppId}`,
  };
}

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.services) || catalog.services.length === 0) {
    throw new Error('platform service catalog must use schemaVersion 1 and contain services');
  }
  const seen = new Set();
  for (const service of catalog.services) {
    const required = ['id', 'name', 'repository', 'authority', 'lanes', 'localPaths', 'workflows', 'branchSources', 'health', 'recoveryDocs', 'alerts', 'runner', 'mutation'];
    for (const key of required) {
      if (!(key in service)) throw new Error(`${service.id ?? 'service'} is missing ${key}`);
    }
    if (!/^[a-z0-9-]+$/.test(service.id) || seen.has(service.id)) {
      throw new Error(`invalid or duplicate service id: ${service.id}`);
    }
    seen.add(service.id);
    for (const key of ['lanes', 'localPaths', 'workflows', 'branchSources', 'health', 'recoveryDocs']) {
      if (!Array.isArray(service[key])) throw new Error(`${service.id}.${key} must be an array`);
    }
    if (!['confirmed', 'unresolved'].includes(service.authority?.status) || typeof service.authority?.detail !== 'string' || !service.authority.detail) {
      throw new Error(`${service.id} has an invalid authority contract`);
    }
    for (const source of service.branchSources) {
      if (typeof source?.ref !== 'string' || !source.ref || source.ref.startsWith('refs/pull/')) {
        throw new Error(`${service.id} has an invalid branch source ref`);
      }
      for (const key of ['paths', 'workflows', 'recoveryDocs']) {
        if (!Array.isArray(source[key])) throw new Error(`${service.id} branch source ${source.ref}.${key} must be an array`);
      }
    }
    const hasRoute = service.workflows.length > 0
      || service.recoveryDocs.length > 0
      || service.branchSources.some((source) => source.workflows.length > 0 || source.recoveryDocs.length > 0);
    if (!hasRoute) throw new Error(`${service.id} has no mechanically verifiable delivery or recovery route`);
    if (service.deliveryPolicy) {
      if (!Array.isArray(service.deliveryPolicy.protectedBranches)
          || service.deliveryPolicy.protectedBranches.length === 0
          || typeof service.deliveryPolicy.requiredContext !== 'string'
          || !service.deliveryPolicy.requiredContext
          || !Number.isSafeInteger(service.deliveryPolicy.requiredAppId)
          || service.deliveryPolicy.requiredAppId <= 0
          || service.deliveryPolicy.requirePullRequest !== true
          || service.deliveryPolicy.requireCodeOwnerReviews !== true
          || !Number.isSafeInteger(service.deliveryPolicy.requiredApprovingReviewCount)
          || service.deliveryPolicy.requiredApprovingReviewCount <= 0
          || service.deliveryPolicy.dismissStaleReviews !== true
          || service.deliveryPolicy.requireLastPushApproval !== true
          || service.deliveryPolicy.requireUpToDate !== true
          || service.deliveryPolicy.allowForcePushes !== false
          || service.deliveryPolicy.allowDeletions !== false) {
        throw new Error(`${service.id} has an invalid delivery policy`);
      }
    }
    for (const endpoint of service.health) {
      if (!endpoint.name || !endpoint.url?.startsWith('https://') || !Array.isArray(endpoint.expectStatus)) {
        throw new Error(`${service.id} has an invalid health endpoint`);
      }
    }
    if (service.runnerVerification) {
      const requiredRunner = ['organization', 'groupId', 'groupName', 'repository', 'workflow', 'runnerName', 'labels'];
      if (requiredRunner.some((key) => !(key in service.runnerVerification)) || !Array.isArray(service.runnerVerification.labels)) {
        throw new Error(`${service.id} has an invalid runner verification contract`);
      }
    }
  }
  return catalog;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 10_000,
    }).trim();
  } catch (error) {
    if (options.optional) return null;
    const stderr = error?.stderr?.toString().trim();
    throw new Error(stderr || `${command} failed`);
  }
}

function parseArgs(argv) {
  const options = {
    catalog: DEFAULT_CATALOG,
    format: 'text',
    githubUser: null,
    noGithub: false,
    noHealth: false,
    strict: false,
    services: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--offline') {
      options.noGithub = true;
      options.noHealth = true;
    } else if (arg === '--no-github') options.noGithub = true;
    else if (arg === '--no-health') options.noHealth = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--catalog') options.catalog = resolve(REPO_ROOT, argv[++index] ?? '');
    else if (arg === '--github-user') options.githubUser = argv[++index] ?? '';
    else if (arg === '--service') options.services.push(argv[++index] ?? '');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown doctor argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: scripts/hb.mjs doctor [options]

  --service ID          inspect only one service (repeatable)
  --github-user LOGIN   inspect a collaborator's effective repository role
  --offline             skip GitHub and public health requests
  --no-github           skip GitHub permission checks
  --no-health           skip public health requests
  --strict              treat warnings as a failing exit status
  --json                emit machine-readable JSON`;
}

function gitEvidence() {
  const head = run('git', ['rev-parse', 'HEAD']);
  const branch = run('git', ['branch', '--show-current']) || '(detached)';
  const porcelain = run('git', ['status', '--porcelain=v1']);
  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { optional: true });
  const tracking = upstream ? run('git', ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], { optional: true }) : null;
  const [behind, ahead] = tracking ? tracking.split(/\s+/).map(Number) : [null, null];
  return {
    head,
    branch,
    upstream,
    clean: porcelain === '',
    changedEntries: porcelain === '' ? 0 : porcelain.split('\n').length,
    ahead,
    behind,
  };
}

function permissionRank(payload) {
  if (payload.role_name) return payload.role_name;
  const permissions = payload.permissions ?? {};
  return ['admin', 'maintain', 'push', 'triage', 'pull'].find((key) => permissions[key]) ?? 'none';
}

function githubPermission(repository, user) {
  if (user) {
    const payload = JSON.parse(run('gh', ['api', `repos/${repository}/collaborators/${user}/permission`]));
    return { login: payload.user?.login ?? user, permission: payload.role_name ?? payload.permission ?? 'unknown' };
  }
  const login = JSON.parse(run('gh', ['api', 'user'])).login;
  const payload = JSON.parse(run('gh', ['api', `repos/${repository}`]));
  return { login, permission: permissionRank(payload) };
}

export function githubContentsExist(payload) {
  return Array.isArray(payload) || (payload !== null && typeof payload === 'object' && typeof payload.sha === 'string');
}

function githubPathExists(repository, path, ref) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const payload = run('gh', ['api', `repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`], { optional: true });
  return payload !== null && githubContentsExist(JSON.parse(payload));
}

function githubBranchProtection(repository, branch) {
  const payload = run('gh', ['api', `repos/${repository}/branches/${encodeURIComponent(branch)}/protection`], { optional: true });
  return payload === null ? null : JSON.parse(payload);
}

function githubRunnerEvidence(expected) {
  const group = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}`]));
  const repositories = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}/repositories`])).repositories ?? [];
  const runners = JSON.parse(run('gh', ['api', `orgs/${expected.organization}/actions/runner-groups/${expected.groupId}/runners`])).runners ?? [];
  const runner = runners.find(({ name }) => name === expected.runnerName);
  const actualLabels = new Set((runner?.labels ?? []).map(({ name }) => name));
  const mismatches = [];
  if (group.name !== expected.groupName) mismatches.push(`group=${group.name}`);
  if (!group.restricted_to_workflows || !group.selected_workflows?.includes(expected.workflow)) mismatches.push('workflow restriction');
  if (!repositories.some(({ full_name: name }) => name === expected.repository)) mismatches.push('repository selection');
  if (!runner || runner.status !== 'online') mismatches.push(`runner=${runner?.status ?? 'missing'}`);
  if (expected.labels.some((label) => !actualLabels.has(label))) mismatches.push('runner labels');
  return { ok: mismatches.length === 0, detail: mismatches.length ? `drift: ${mismatches.join(', ')}` : `${group.name}; ${runner.name} online; exact workflow restriction` };
}

function deployedRevisionEvidence(repository, revision, lanes, noGithub) {
  if (!/^[0-9a-f]{40}$/.test(revision)) return result('warning', 'revision-drift', 'service returned malformed provenance');
  if (!noGithub && repository) {
    const containing = [];
    for (const lane of lanes) {
      const status = run('gh', ['api', `repos/${repository}/compare/${revision}...${encodeURIComponent(lane)}`, '--jq', '.status'], { optional: true });
      if (status === 'ahead' || status === 'identical') containing.push(lane);
    }
    if (containing.length > 0) return result('ok', 'revision-drift', `${revision} contained in remote ${containing.join(', ')}`);
    return result('warning', 'revision-drift', `${revision} is not contained in a configured remote lane`);
  }
  const present = run('git', ['cat-file', '-e', `${revision}^{commit}`], { optional: true }) !== null;
  if (!present) return result('warning', 'revision-drift', `${revision} is not present in the local object database`);
  const containing = [];
  for (const lane of lanes) {
    for (const ref of [`upstream/${lane}`, lane]) {
      if (run('git', ['rev-parse', '--verify', '--quiet', ref], { optional: true }) === null) continue;
      if (run('git', ['merge-base', '--is-ancestor', revision, ref], { optional: true }) !== null) containing.push(ref);
    }
  }
  if (containing.length === 0) return result('warning', 'revision-drift', `${revision} is not contained in a configured lane`);
  return result('ok', 'revision-drift', `${revision} contained in cached ${[...new Set(containing)].join(', ')}`);
}

async function healthEvidence(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(endpoint.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain;q=0.5', 'user-agent': 'hb-doctor/1' },
    });
    let provenance = null;
    let serviceStatus = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const text = (await response.text()).slice(0, 65_536);
      try {
        const payload = JSON.parse(text);
        provenance = endpoint.provenanceField ? payload?.[endpoint.provenanceField] ?? null : null;
        serviceStatus = typeof payload?.status === 'string' ? payload.status : null;
      } catch {
        serviceStatus = 'invalid-json';
      }
    } else {
      await response.body?.cancel();
    }
    return { status: response.status, ok: endpoint.expectStatus.includes(response.status), provenance, serviceStatus };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspect({ catalog, options }) {
  const results = [];
  let git = null;
  try {
    git = gitEvidence();
    results.push(result(git.clean ? 'ok' : 'warning', 'repository.worktree', git.clean ? 'clean' : `${git.changedEntries} changed entries`));
    results.push(result(git.upstream ? 'ok' : 'warning', 'repository.tracking', git.upstream ? `ahead=${git.ahead} behind=${git.behind}` : 'no configured upstream'));
  } catch (error) {
    results.push(result('error', 'repository.git', error.message));
  }

  const selected = options.services.length
    ? catalog.services.filter((service) => options.services.includes(service.id))
    : catalog.services;
  const missing = options.services.filter((id) => !catalog.services.some((service) => service.id === id));
  for (const id of missing) results.push(result('error', `service.${id}`, 'not present in catalog'));

  const localRepository = run('git', ['config', '--get', 'remote.upstream.url'], { optional: true })
    ?? run('git', ['config', '--get', 'remote.origin.url'], { optional: true });
  const isLocalRepo = (repository) => repository && localRepository?.includes(repository);

  for (const service of selected) {
    results.push(result('ok', `${service.id}.route`, `repo=${service.repository ?? 'unresolved'} lanes=${service.lanes.join(',') || 'unresolved'}`));
    results.push(result('ok', `${service.id}.runner`, service.runner));
    results.push(result('ok', `${service.id}.staging`, service.staging?.join(', ') || 'none documented'));
    results.push(result('ok', `${service.id}.alerts`, service.alerts));
    results.push(result('ok', `${service.id}.mutation-policy`, service.mutation));
    if (service.authority.status === 'unresolved') {
      results.push(result('warning', `${service.id}.authority`, service.authority.detail));
    } else {
      results.push(result('ok', `${service.id}.authority`, service.authority.detail));
    }
    if (!service.repository) {
      // The explicit authority result above is the fail-closed route.
    } else if (options.noGithub) {
      results.push(result('skipped', `${service.id}.github`, 'network checks disabled'));
    } else {
      try {
        const permission = githubPermission(service.repository, options.githubUser);
        const usable = ['admin', 'maintain', 'write', 'push'].includes(permission.permission);
        results.push(result(usable ? 'ok' : 'warning', `${service.id}.github`, `${permission.login}: ${permission.permission}`));
      } catch (error) {
        results.push(result('warning', `${service.id}.github`, `unavailable: ${error.message}`));
      }
    }

    if (isLocalRepo(service.repository)) results.push(...inspectLocalRoutes(service));

    for (const source of service.branchSources) {
      if (options.noGithub || !service.repository) {
        results.push(result('skipped', `${service.id}.branch-source`, `${source.ref}: network checks disabled or repository unresolved`));
      } else {
        results.push(...await inspectBranchSource(
          service,
          source,
          (path, ref) => githubPathExists(service.repository, path, ref),
        ));
      }
    }

    if (service.deliveryPolicy) {
      for (const branch of service.deliveryPolicy.protectedBranches) {
        if (options.noGithub || !service.repository) {
          results.push(result('skipped', `${service.id}.delivery-protection`, `${branch}: network checks disabled or repository unresolved`));
        } else {
          const evidence = evaluateDeliveryProtection(
            service.deliveryPolicy,
            branch,
            githubBranchProtection(service.repository, branch),
          );
          results.push(result(evidence.ok ? 'ok' : 'error', `${service.id}.delivery-protection`, evidence.detail));
        }
      }
    }

    if (service.runnerVerification) {
      if (options.noGithub) {
        results.push(result('skipped', `${service.id}.runner-live`, 'network checks disabled'));
      } else {
        try {
          const runner = githubRunnerEvidence(service.runnerVerification);
          results.push(result(runner.ok ? 'ok' : 'error', `${service.id}.runner-live`, runner.detail));
        } catch (error) {
          results.push(result('warning', `${service.id}.runner-live`, `not visible to current GitHub credential: ${error.message}`));
        }
      }
    }

    const deployedRevisions = [];
    for (const endpoint of service.health) {
      if (options.noHealth) {
        results.push(result('skipped', `${service.id}.${endpoint.name}`, 'network checks disabled'));
        continue;
      }
      try {
        const evidence = await healthEvidence(endpoint);
        const detail = [`HTTP ${evidence.status}`];
        if (evidence.serviceStatus) detail.push(`status=${evidence.serviceStatus}`);
        if (evidence.provenance) detail.push(`revision=${evidence.provenance}`);
        if (evidence.provenance) deployedRevisions.push(evidence.provenance);
        results.push(result(evidence.ok ? 'ok' : 'error', `${service.id}.${endpoint.name}`, detail.join(' '), { evidence }));
      } catch (error) {
        results.push(result('error', `${service.id}.${endpoint.name}`, `unreachable: ${error.message}`));
      }
    }
    if (isLocalRepo(service.repository)) {
      for (const revision of [...new Set(deployedRevisions)]) {
        const drift = deployedRevisionEvidence(service.repository, revision, service.lanes, options.noGithub);
        results.push({ ...drift, check: `${service.id}.${drift.check}` });
      }
    }
  }

  const summary = results.reduce((counts, item) => {
    counts[item.level] = (counts[item.level] ?? 0) + 1;
    return counts;
  }, { ok: 0, warning: 0, error: 0, skipped: 0 });
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), git, selectedServices: selected.map(({ id }) => id), results, summary };
}

function printText(report) {
  if (report.git) {
    console.log(`repository ${report.git.branch} ${report.git.head}${report.git.upstream ? ` upstream=${report.git.upstream}` : ''}`);
  }
  for (const item of report.results) console.log(`${item.level.toUpperCase().padEnd(7)} ${item.check}: ${item.detail}`);
  const { ok, warning, error, skipped } = report.summary;
  console.log(`summary ok=${ok} warning=${warning} error=${error} skipped=${skipped}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const catalog = validateCatalog(JSON.parse(readFileSync(options.catalog, 'utf8')));
  const report = await inspect({ catalog, options });
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (report.summary.error > 0) return 1;
  if (options.strict && report.results.some((item) => LEVEL_ORDER[item.level] >= LEVEL_ORDER.warning)) return 1;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`hb doctor: ${error.message}`);
    process.exitCode = 1;
  });
}
