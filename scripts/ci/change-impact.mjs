#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICES = ['analytics', 'app', 'commerce-reconciler', 'playlist-bot', 'tapestry'];
const LIVE_SERVICES = new Set(['app', 'commerce-reconciler', 'playlist-bot', 'tapestry']);
const ARTIFACT_FOR_SERVICE = {
  analytics: 'analytics',
  app: 'app',
  'commerce-reconciler': 'app',
  'playlist-bot': 'playlist-bot',
  tapestry: 'tapestry',
};
const RISK_ORDER = { documentation: 0, ui: 1, functional: 2, critical: 3 };
const CONTEXT_ORDER = [
  'diff-check',
  'lint-and-build',
  'test',
  'tapestry',
  'playlist',
  'analytics',
  'e2e',
  'account',
  'frozen-audio-paths',
];
const JOB_CHECK_ORDER = ['impact', 'lint-and-build', 'test', 'tapestry', 'playlist', 'analytics'];

export const COVERAGE_MATRICES = Object.freeze({
  ui: ['component', 'chromium-android-responsive', 'affected-visual'],
  functional: {
    app: ['app-integration', 'chromium-android-journey'],
    tapestry: ['tapestry-integration'],
    'playlist-bot': ['playlist-media-integration'],
    analytics: ['analytics-contract'],
  },
  critical: {
    audio: ['audio:frozen-paths', 'audio:media-continuity', 'audio:browser-engines'],
    auth: ['auth:oidc-cookie-logout', 'auth:account-chromium-android'],
    grants: ['grants:effects-integration', 'grants:rollback-compatibility'],
    payments: ['payments:commerce-sandbox', 'payments:entitlement-replay'],
    data: ['data:migration-state', 'data:backup-isolated-restore', 'data:app-worker-schema-compatibility'],
    infrastructure: ['infrastructure:workflow-helper-boundary', 'infrastructure:interrupted-stale-recovery'],
  },
  crossDomain: [
    'required-check-completeness',
    'interrupted-run-resume',
    'stale-candidate-cas',
    'app-worker-schema-compatibility',
  ],
});

const CHECKS = Object.freeze({
  'diff-check': { check: 'diff-check', command: 'git diff --check' },
  'agent-skill-distributions': { check: 'agent-skill-distributions', command: 'python3 .agents/skills/scripts/render_distributions.py --check' },
  'ops-tooling': { check: 'ops-tooling', command: 'npm run test:ops-tooling' },
  'lint-and-build': { check: 'lint-and-build', command: 'npm run lint && npm run build' },
  test: { check: 'test', command: 'npm run test:coverage' },
  analytics: { check: 'analytics', command: 'npm test --prefix services/analytics' },
  tapestry: { check: 'tapestry', command: 'npm test --prefix services/tapestry' },
  'commerce-contract': { check: 'commerce-contract', command: 'npm run contract:commerce:verify' },
  e2e: { check: 'e2e', command: 'execute every selected matrix entry; no required result may be skipped' },
  'frozen-audio-paths': { check: 'frozen-audio-paths', command: 'audio-touching review and frozen audio suite' },
  'auth-contract': { check: 'auth-contract', command: 'auth, Account RP, cookie and logout contracts' },
  'grant-recovery': { check: 'grant-recovery', command: 'grant effects, fences and app/worker/schema recovery' },
  'data-recovery': { check: 'data-recovery', command: 'verified migration state and backup/isolated restore when pending' },
  'workflow-review': { check: 'workflow-review', command: 'review workflow, helper, permissions and interruption safety' },
  'release-qualification': { check: 'release-qualification', command: 'qualify the exact selected digest and recovery plan' },
});

function normalize(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function maximumRisk(left, right) {
  return RISK_ORDER[right] > RISK_ORDER[left] ? right : left;
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function pathFacts(path) {
  const facts = { recognized: false, risk: 'documentation', domains: [], services: [], checks: [], reusePrior: [] };
  const set = (risk, domains, services, checks = [], reusePrior = []) => {
    facts.recognized = true;
    facts.risk = maximumRisk(facts.risk, risk);
    addAll(new Set(facts.domains), domains);
    facts.domains.push(...domains.filter((item) => !facts.domains.includes(item)));
    facts.services.push(...services.filter((item) => !facts.services.includes(item)));
    facts.checks.push(...checks.filter((item) => !facts.checks.includes(item)));
    facts.reusePrior.push(...reusePrior.filter((item) => !facts.reusePrior.includes(item)));
  };

  if (path.startsWith('.agents/skills/')) {
    set('documentation', ['documentation'], [], ['agent-skill-distributions']);
    return facts;
  }
  if (path.startsWith('contracts/commerce-entitlement/') && path.endsWith('.md')) {
    set('documentation', ['documentation'], [], ['commerce-contract']);
    return facts;
  }
  if (path.endsWith('.md') || path.startsWith('docs/')) {
    set('documentation', ['documentation'], []);
    return facts;
  }

  if (/^src\/.*\.css$/u.test(path)) set('ui', ['ui'], ['app']);
  if (/^(src\/components\/|src\/app\/)/u.test(path) && !path.endsWith('.css')) set('functional', ['app'], ['app']);
  if (/^src\/lib\//u.test(path)) set('functional', ['app'], ['app', 'commerce-reconciler']);
  if (/^(src\/middleware|middleware\.|next\.config\.)/u.test(path)) set('functional', ['app'], ['app']);
  if (/^services\/tapestry\//u.test(path)) set('functional', ['tapestry'], ['tapestry'], ['tapestry']);
  if (/^services\/playlist-bot\//u.test(path)) set('functional', ['playlist-bot'], ['playlist-bot']);
  if (/^(services\/analytics|ops\/analytics|contracts\/analytics)\//u.test(path)) set('functional', ['analytics'], ['analytics'], ['analytics']);

  if (/AudioContext|room-audio|audio-|playback|facilitator-audio|services\/playlist-bot/u.test(path)) {
    set('critical', ['audio'], path.startsWith('services/playlist-bot/') ? ['playlist-bot'] : ['app'], ['frozen-audio-paths']);
  }
  if (/(^|\/)(auth|account|login|ticket|principal|admission|middleware)([./-]|$)|BEACON_ACCOUNT_LIVE_RP/u.test(path)) {
    set('critical', ['auth'], ['app'], ['auth-contract']);
  }
  if (/stage-grant|grant-effects|grant-lock|room-entitlement/u.test(path)) {
    set('critical', ['grants'], ['app', 'commerce-reconciler'], ['grant-recovery']);
  }
  if (/commerce|payment|entitlement/u.test(path)) {
    set('critical', ['payments'], ['app', 'commerce-reconciler'], ['commerce-contract']);
  }
  if (/^prisma\//u.test(path) || path === 'prisma.config.ts' || /seed|backfill/u.test(path)) {
    set('critical', ['data'], ['app', 'commerce-reconciler'], ['data-recovery']);
  }

  if (/^scripts\/(ops|ci)\//u.test(path) || path === 'scripts/hb.mjs' || path === 'AGENTS.md') {
    set('critical', ['infrastructure'], [], ['ops-tooling', 'workflow-review']);
  }
  if (/^deploy\/runtime-public-config\/[^/]+\.json$/u.test(path)) {
    set('critical', ['infrastructure'], ['app'], ['ops-tooling', 'workflow-review'], ['app']);
  }
  if (/^(\.github\/workflows\/|\.github\/CODEOWNERS$|deploy\/(?!runtime-public-config\/)|docker-compose\.yml$)/u.test(path)) {
    set('critical', ['infrastructure'], SERVICES, ['ops-tooling', 'workflow-review']);
  }
  if (path === 'Dockerfile') set('critical', ['infrastructure'], ['app', 'commerce-reconciler'], ['workflow-review']);
  if (/^(package-lock\.json|package\.json|tsconfig\.json|vitest\.config\.ts)$/u.test(path)) {
    set('critical', ['infrastructure'], SERVICES, ['workflow-review']);
  }
  return facts;
}

function factsForLabel(label) {
  const domain = /^impact:(audio|auth|grants|payments|data)$/u.exec(label)?.[1];
  if (domain) {
    const services = domain === 'grants' || domain === 'payments' || domain === 'data'
      ? ['app', 'commerce-reconciler'] : ['app'];
    return { risk: 'critical', domains: [domain], services };
  }
  if (label === 'impact:critical') return { risk: 'critical', domains: ['infrastructure'], services: SERVICES };
  if (label === 'impact:functional') return { risk: 'functional', domains: ['app'], services: ['app'] };
  if (label === 'impact:ui') return { risk: 'ui', domains: ['ui'], services: ['app'] };
  return null;
}

function artifactList(services) {
  return [...new Set(services.filter((service) => LIVE_SERVICES.has(service)).map((service) => ARTIFACT_FOR_SERVICE[service]))].sort();
}

function selectedMatrices(risk, domains) {
  const ui = RISK_ORDER[risk] >= RISK_ORDER.ui ? [...COVERAGE_MATRICES.ui] : [];
  const functional = new Set();
  if (RISK_ORDER[risk] >= RISK_ORDER.functional) {
    for (const domain of domains) addAll(functional, COVERAGE_MATRICES.functional[domain] ?? []);
    if (!functional.size) addAll(functional, Object.values(COVERAGE_MATRICES.functional).flat());
  }
  const critical = new Set();
  if (risk === 'critical') {
    for (const domain of domains) addAll(critical, COVERAGE_MATRICES.critical[domain] ?? []);
  }
  return {
    ui,
    functional: [...functional],
    critical: [...critical],
    crossDomain: risk === 'critical' ? [...COVERAGE_MATRICES.crossDomain] : [],
  };
}

function checksFor(risk, domains, pathChecks, services) {
  const names = new Set(['diff-check', ...pathChecks]);
  const appRequired = services.includes('app') || services.includes('commerce-reconciler');
  if (appRequired) addAll(names, ['lint-and-build', 'test', 'e2e']);
  if (risk === 'critical' && domains.includes('audio')) names.add('e2e');
  if (domains.includes('analytics')) names.add('analytics');
  if (domains.includes('tapestry')) names.add('tapestry');
  if (domains.includes('payments')) names.add('commerce-contract');
  if (domains.includes('audio')) names.add('frozen-audio-paths');
  if (domains.includes('auth')) names.add('auth-contract');
  if (domains.includes('grants')) names.add('grant-recovery');
  if (domains.includes('data')) names.add('data-recovery');
  if (risk === 'critical') names.add('release-qualification');
  return Object.keys(CHECKS).filter((name) => names.has(name)).map((name) => CHECKS[name]);
}

function requiredContextsFor(risk, domains, requiredChecks, requiredJobChecks) {
  if (risk === 'critical' && domains.includes('infrastructure')) return [...CONTEXT_ORDER];
  const checks = new Set(requiredChecks.map(({ check }) => check));
  const contexts = new Set(['diff-check']);
  for (const name of requiredJobChecks) {
    contexts.add(name);
  }
  if (checks.has('commerce-contract')) contexts.add('test');
  if (checks.has('e2e')) {
    contexts.add('e2e');
    contexts.add('account');
  }
  if (checks.has('frozen-audio-paths')) contexts.add('frozen-audio-paths');
  return CONTEXT_ORDER.filter((name) => contexts.has(name));
}

function requiredJobChecksFor(services, matrices) {
  const names = new Set(['impact']);
  const functional = new Set(matrices.functional);
  if (services.includes('app') || services.includes('commerce-reconciler') || matrices.ui.length > 0 ||
      functional.has('app-integration') || functional.has('chromium-android-journey')) {
    addAll(names, ['lint-and-build', 'test']);
  }
  if (services.includes('tapestry') || functional.has('tapestry-integration')) names.add('tapestry');
  if (services.includes('playlist-bot') || functional.has('playlist-media-integration')) names.add('playlist');
  if (services.includes('analytics') || functional.has('analytics-contract')) names.add('analytics');
  return JOB_CHECK_ORDER.filter((name) => names.has(name));
}

export function classifyChanges(inputFiles, options = {}) {
  const files = [...new Set(inputFiles.map(normalize).filter(Boolean))].sort();
  let risk = 'documentation';
  const domains = new Set();
  const services = new Set();
  const pathChecks = new Set();
  const imageChangedServices = new Set();
  const reusePriorCandidates = new Set();
  const unknown = [];
  let dataPathDetected = false;

  for (const path of files) {
    const facts = pathFacts(path);
    if (!facts.recognized) {
      unknown.push(path);
      risk = 'critical';
      addAll(domains, ['audio', 'auth', 'data', 'grants', 'payments', 'unknown']);
      addAll(services, SERVICES);
      addAll(imageChangedServices, SERVICES);
      continue;
    }
    risk = maximumRisk(risk, facts.risk);
    addAll(domains, facts.domains);
    addAll(services, facts.services);
    addAll(reusePriorCandidates, facts.reusePrior);
    addAll(imageChangedServices, facts.services.filter((service) => !facts.reusePrior.includes(service)));
    addAll(pathChecks, facts.checks);
    if (facts.domains.includes('data')) dataPathDetected = true;
  }

  for (const label of options.labels ?? []) {
    const facts = factsForLabel(label);
    if (!facts) continue;
    risk = maximumRisk(risk, facts.risk);
    addAll(domains, facts.domains);
    addAll(services, facts.services);
    addAll(imageChangedServices, facts.services);
  }

  if (files.length === 0 && domains.size === 0) domains.add('documentation');
  if (risk === 'documentation' && !domains.size) domains.add('documentation');
  const sortedDomains = [...domains].sort();
  const classifiedServices = [...services].sort();
  const sortedServices = classifiedServices.filter((service) => LIVE_SERVICES.has(service));
  const reusePriorImages = sortedServices.filter((service) => reusePriorCandidates.has(service) && !imageChangedServices.has(service));
  const deploy = sortedServices.length > 0;
  const inspectMigrations = dataPathDetected || unknown.length > 0;
  const matrices = selectedMatrices(risk, sortedDomains);
  const requiredChecks = checksFor(risk, sortedDomains, pathChecks, sortedServices);
  const requiredJobChecks = requiredJobChecksFor(classifiedServices, matrices);
  const humanReviewRequired = (options.labels ?? []).includes('requires-human-review');
  const report = {
    schemaVersion: 'harmonic-beacon.change-impact.v2',
    risk,
    files,
    domains: sortedDomains,
    categories: sortedDomains,
    labels: [...new Set(options.labels ?? [])].sort(),
    matrices,
    requiredChecks,
    requiredJobChecks,
    requiredContexts: requiredContextsFor(risk, sortedDomains, requiredChecks, requiredJobChecks),
    humanReviewRequired,
    humanReviewReason: humanReviewRequired ? 'requires-human-review label is present' : null,
    deployment: {
      deploy,
      artifactsToPull: artifactList(sortedServices.filter((service) => !reusePriorImages.includes(service))),
      servicesToReplace: sortedServices,
      reusePriorImages,
      migration: inspectMigrations ? 'verify-pending' : 'never',
      recovery: !deploy ? 'none' : inspectMigrations ? 'backup-restore-if-pending' : 'image-config',
    },
    details: {
      frozenAudioPaths: files.filter((path) => pathFacts(path).domains.includes('audio')),
      unclassifiedPaths: unknown,
      deployedServiceBases: {},
    },
    notes: [],
  };
  if (unknown.length) report.notes.push('Unknown paths expand all critical domains and services; database state is inspected rather than assuming a migration.');
  if (risk === 'critical') report.notes.push('Every selected required check must report success; missing, cancelled, failed, or skipped is rejection.');
  return report;
}

export function classifyDeployedServiceChanges({ diffByService, serviceReleases, labels = [] }) {
  const files = new Set();
  const affected = new Set();
  for (const service of SERVICES) {
    const diff = diffByService[service];
    if (!Array.isArray(diff)) throw new Error(`missing deployed diff for service: ${service}`);
    for (const rawPath of diff) {
      const path = normalize(rawPath);
      const facts = pathFacts(path);
      if (!facts.recognized) {
        files.add(path);
        addAll(affected, LIVE_SERVICES);
        continue;
      }
      if (facts.services.includes(service)) {
        files.add(path);
        if (LIVE_SERVICES.has(service)) affected.add(service);
      }
    }
  }
  const report = classifyChanges([...files], { labels });
  const labelServices = new Set();
  for (const label of labels) addAll(labelServices, factsForLabel(label)?.services ?? []);
  addAll(affected, [...labelServices].filter((service) => LIVE_SERVICES.has(service)));
  const selected = [...affected].sort();
  const reusePriorImages = (report.deployment.reusePriorImages ?? []).filter((service) => selected.includes(service));
  report.deployment.deploy = selected.length > 0;
  report.deployment.servicesToReplace = selected;
  report.deployment.reusePriorImages = reusePriorImages;
  report.deployment.artifactsToPull = artifactList(selected.filter((service) => !reusePriorImages.includes(service)));
  report.deployment.recovery = !selected.length ? 'none' : report.deployment.migration === 'verify-pending'
    ? 'backup-restore-if-pending' : 'image-config';
  report.details.deployedServiceBases = Object.fromEntries(SERVICES.map((service) => {
    const sourceSha = serviceReleases?.[service]?.sourceSha;
    if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? '')) throw new Error(`invalid deployed source for service: ${service}`);
    return [service, sourceSha];
  }));
  return report;
}

export function verifyRequiredCheckResults(requiredChecks, results) {
  if (!Array.isArray(requiredChecks) || !Array.isArray(results)) throw new Error('required check results must be arrays');
  const byName = new Map();
  for (const entry of results) {
    if (!entry || typeof entry.check !== 'string' || typeof entry.conclusion !== 'string' || byName.has(entry.check)) {
      throw new Error('required check results are malformed or duplicated');
    }
    byName.set(entry.check, entry.conclusion);
  }
  for (const check of requiredChecks) {
    if (byName.get(check) !== 'success') {
      throw new Error(`required check ${check} is missing or did not succeed`);
    }
  }
  return [...requiredChecks];
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOptional(repo, args) {
  try { return git(repo, args); } catch { return null; }
}

function defaultBase(repo) {
  for (const ref of ['upstream/main', 'origin/main', 'main']) {
    if (gitOptional(repo, ['rev-parse', '--verify', '--quiet', ref]) !== null) return ref;
  }
  throw new Error('cannot resolve a default main ref; pass --base explicitly');
}

function parseArgs(argv) {
  const options = { base: null, head: 'HEAD', files: [], format: 'text', workingTree: false, labels: [], repo: REPO_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') options.base = argv[++index] ?? '';
    else if (arg === '--head') options.head = argv[++index] ?? '';
    else if (arg === '--repo') options.repo = resolve(argv[++index] ?? '');
    else if (arg === '--deployed-state') options.deployedState = resolve(argv[++index] ?? '');
    else if (arg === '--label') options.labels.push(argv[++index] ?? '');
    else if (arg === '--file') options.files.push(argv[++index] ?? '');
    else if (arg === '--files-from') options.files.push(...readFileSync(argv[++index] ?? '', 'utf8').split(/\r?\n/u));
    else if (arg === '--stdin') options.files.push(...readFileSync(0, 'utf8').split(/\r?\n/u));
    else if (arg === '--working-tree') options.workingTree = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown change-impact argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: scripts/hb.mjs change-impact [options]\n\n  --deployed-state PATH  compare each service from its deployed release (preferred)\n  --base REF             compare the complete base..head range\n  --head REF             comparison head (default HEAD)\n  --label NAME           add risk; labels never downgrade detected risk\n  --working-tree         include staged, unstaged and untracked paths\n  --file PATH            classify an explicit path (repeatable)\n  --json                 emit machine-readable JSON`;
}

export function committedDiff(repo, base, head) {
  try {
    git(repo, ['merge-base', '--is-ancestor', base, head]);
  } catch {
    throw new Error(`deployed source is not an ancestor of candidate: ${base}`);
  }
  const output = git(repo, ['diff', '--no-renames', '--name-only', `${base}..${head}`]);
  return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

function changedFiles(options) {
  if (options.files.length) return classifyChanges(options.files, { labels: options.labels });
  if (options.deployedState) {
    const state = JSON.parse(readFileSync(options.deployedState, 'utf8'));
    const diffByService = Object.fromEntries(SERVICES.map((service) => [
      service, committedDiff(options.repo, state.serviceReleases?.[service]?.sourceSha ?? '', options.head),
    ]));
    return classifyDeployedServiceChanges({ diffByService, serviceReleases: state.serviceReleases, labels: options.labels });
  }
  const base = options.base || defaultBase(options.repo);
  const files = committedDiff(options.repo, base, options.head);
  if (options.workingTree) {
    for (const args of [
      ['diff', '--no-renames', '--name-only'],
      ['diff', '--cached', '--no-renames', '--name-only'],
      ['ls-files', '--others', '--exclude-standard'],
    ]) {
      const output = git(options.repo, args);
      if (output) files.push(...output.split(/\r?\n/u).filter(Boolean));
    }
  }
  return classifyChanges(files, { labels: options.labels });
}

function printText(report) {
  console.log(`risk: ${report.risk}`);
  console.log(`files: ${report.files.length}`);
  console.log(`domains: ${report.domains.join(', ') || 'none'}`);
  console.log(`services: ${report.deployment.servicesToReplace.join(', ') || 'none'}`);
  console.log('required checks:');
  for (const item of report.requiredChecks) console.log(`  - ${item.check}: ${item.command}`);
  for (const note of report.notes) console.log(`note: ${note}`);
}

export function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'verify-results') {
    const impactIndex = argv.indexOf('--impact');
    const resultsIndex = argv.indexOf('--results');
    if (impactIndex < 0 || !argv[impactIndex + 1] || resultsIndex < 0 || !argv[resultsIndex + 1]) {
      throw new Error('verify-results requires --impact and --results');
    }
    const impact = JSON.parse(readFileSync(resolve(argv[impactIndex + 1]), 'utf8'));
    const results = JSON.parse(readFileSync(resolve(argv[resultsIndex + 1]), 'utf8'));
    verifyRequiredCheckResults(impact.requiredJobChecks, results);
    console.log(JSON.stringify({ verified: impact.requiredJobChecks }));
    return 0;
  }
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return 0; }
  const report = changedFiles(options);
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else printText(report);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(`hb change-impact: ${error.message}`);
    process.exitCode = 1;
  }
}
