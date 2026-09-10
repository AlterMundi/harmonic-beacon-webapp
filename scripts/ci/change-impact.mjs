#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const checks = {
  'diff-check': { check: 'diff-check', command: 'git diff --check' },
  skills: { check: 'agent-skill-distributions', command: 'python3 .agents/skills/scripts/render_distributions.py --check' },
  ops: { check: 'ops-tooling', command: 'npm run test:ops-tooling' },
  lintBuild: { check: 'lint-and-build', command: 'npm run lint && npm run build' },
  unit: { check: 'test', command: 'npm run test:coverage' },
  analytics: { check: 'analytics', command: 'npm test --prefix services/analytics' },
  tapestry: { check: 'tapestry', command: 'npm test --prefix services/tapestry' },
  commerce: { check: 'commerce-contract', command: 'npm run contract:commerce:verify' },
  e2e: { check: 'e2e', command: 'use .github/workflows/e2e.yml for the integrated candidate' },
  audio: { check: 'frozen-audio-paths', command: 'require audio-touching label and independent risk-bearing review' },
  workflow: { check: 'workflow-review', command: 'review workflow permissions, triggers, concurrency and immutable actions' },
  release: { check: 'release-qualification', command: 'qualify the exact integrated release candidate before production' },
};

const contextOrder = [
  'diff-check',
  'lint-and-build',
  'test',
  'analytics',
  'e2e',
  'account',
  'frozen-audio-paths',
];

const emittedContexts = {
  'diff-check': ['diff-check'],
  skills: ['lint-and-build'],
  ops: ['lint-and-build'],
  lintBuild: ['lint-and-build'],
  unit: ['test'],
  analytics: ['analytics'],
  tapestry: ['test'],
  commerce: ['test'],
  e2e: ['e2e', 'account'],
  audio: ['frozen-audio-paths'],
  workflow: [],
  release: [],
};

function normalize(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function add(target, ...items) {
  for (const item of items) target.add(item);
}

export function classifyChanges(inputFiles) {
  const files = [...new Set(inputFiles.map(normalize).filter(Boolean))].sort();
  const categories = new Set();
  const required = new Set(['diff-check']);
  const notes = [];

  const documentationFiles = files.filter((file) => file.endsWith('.md') || file.startsWith('docs/'));
  // Markdown-only changes are excluded by the browser workflow. Do not select a
  // browser context that GitHub will never emit for those paths.
  const executableFiles = files.filter((file) => !documentationFiles.includes(file));
  const skillFiles = files.filter((file) => file.startsWith('.agents/skills/'));
  const opsFiles = files.filter((file) => /^(AGENTS\.md|docs\/ops\/OPERATING_CONTRACT\.md|deploy\/(platform-services\.json|schemas\/platform-services\.schema\.json)|scripts\/(hb\.mjs|ops\/|ci\/))/.test(file));
  const workflowFiles = executableFiles.filter((file) => file.startsWith('.github/workflows/') || file === '.github/CODEOWNERS');
  const analyticsFiles = executableFiles.filter((file) => /^(services\/analytics|ops\/analytics|contracts\/analytics)\//.test(file));
  const tapestryFiles = executableFiles.filter((file) => file.startsWith('services/tapestry/'));
  const playlistFiles = executableFiles.filter((file) => file.startsWith('services/playlist-bot/'));
  const commerceFiles = files.filter((file) => /^(contracts\/commerce-entitlement\/|scripts\/commerce-media-worker\.ts$|src\/app\/api\/internal\/v1\/commerce-entitlements\/)/.test(file));
  const commerceRuntimeFiles = executableFiles.filter((file) => commerceFiles.includes(file));
  const databaseFiles = executableFiles.filter((file) => file.startsWith('prisma/') || file === 'prisma.config.ts');
  const audioFiles = executableFiles.filter((file) => file === 'src/context/AudioContext.tsx' || file.startsWith('src/app/session/') || file.startsWith('services/playlist-bot/'));
  const e2eFiles = executableFiles.filter((file) => file.startsWith('e2e/') || file === 'playwright.config.ts');
  const appFiles = executableFiles.filter((file) => /^(src\/|middleware\.test\.ts$|next\.config\.ts$|package(-lock)?\.json$|Dockerfile$|docker-compose\.yml$|public\/)/.test(file));
  const deployFiles = executableFiles.filter((file) => /^(deploy\/|Dockerfile$|docker-compose\.yml$)/.test(file) && !/^deploy\/(platform-services\.json|schemas\/)/.test(file));
  const deliveryControlFiles = executableFiles.filter((file) =>
    file === '.github/CODEOWNERS'
      || file.startsWith('.github/workflows/')
      || file.startsWith('scripts/ci/')
      || file === 'deploy/hb-deploy-root'
      || file === 'deploy/beacon-runner.sudoers'
      || file === 'docker-compose.yml'
      || file === 'Dockerfile'
      || file.startsWith('scripts/live-production/'));

  if (skillFiles.length) { categories.add('agent-skills'); required.add('skills'); }
  if (opsFiles.length) { categories.add('operations-tooling'); required.add('ops'); }
  if (workflowFiles.length) { categories.add('workflow'); add(required, 'workflow', 'lintBuild', 'unit'); }
  if (analyticsFiles.length) { categories.add('analytics'); required.add('analytics'); }
  if (tapestryFiles.length) { categories.add('tapestry'); add(required, 'tapestry', 'lintBuild', 'unit', 'e2e'); }
  if (playlistFiles.length) { categories.add('playlist-media'); add(required, 'lintBuild', 'unit', 'e2e'); }
  if (commerceFiles.length) { categories.add('commerce'); add(required, 'commerce'); }
  if (commerceRuntimeFiles.length) { add(required, 'lintBuild', 'unit', 'e2e'); }
  if (databaseFiles.length) { categories.add('database-migrations'); add(required, 'lintBuild', 'unit', 'e2e', 'release'); }
  if (audioFiles.length) { categories.add('frozen-audio'); add(required, 'audio', 'lintBuild', 'unit', 'e2e'); }
  if (e2eFiles.length) { categories.add('browser-tests'); required.add('e2e'); }
  if (appFiles.length) { categories.add('live-app'); add(required, 'lintBuild', 'unit', 'e2e'); }
  if (deployFiles.length) { categories.add('deployment'); add(required, 'workflow', 'lintBuild', 'unit', 'e2e', 'release'); }
  if (deliveryControlFiles.length) add(required, 'lintBuild', 'unit', 'analytics', 'e2e', 'audio');
  if (documentationFiles.length) categories.add('documentation');

  const recognized = new Set([
    ...skillFiles, ...opsFiles, ...workflowFiles, ...analyticsFiles, ...tapestryFiles,
    ...playlistFiles, ...commerceFiles, ...databaseFiles, ...audioFiles, ...e2eFiles,
    ...appFiles, ...deployFiles, ...documentationFiles,
  ]);
  const unknown = files.filter((file) => !recognized.has(file));
  if (unknown.length) {
    categories.add('unclassified');
    add(required, 'lintBuild', 'unit', 'e2e');
    notes.push('Unclassified paths conservatively require the core application and browser gates.');
  }
  if (files.length === 0) notes.push('No changed files were supplied or found.');
  if (audioFiles.length) notes.push('Frozen audio paths require the audio-touching label and independent review; classification does not grant approval.');
  if (deployFiles.length || databaseFiles.length) notes.push('Production promotion still requires exact-candidate qualification, live preflight and recovery evidence.');

  const orderedKeys = Object.keys(checks).filter((key) => required.has(key));
  const selectedContexts = new Set(orderedKeys.flatMap((key) => emittedContexts[key]));
  return {
    schemaVersion: 1,
    files,
    categories: [...categories].sort(),
    requiredChecks: orderedKeys.map((key) => checks[key]),
    requiredContexts: contextOrder.filter((context) => selectedContexts.has(context)),
    notes,
    details: {
      frozenAudioPaths: audioFiles,
      unclassifiedPaths: unknown,
    },
  };
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOptional(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function defaultBase() {
  for (const ref of ['upstream/main', 'origin/main', 'main']) {
    if (gitOptional(['rev-parse', '--verify', '--quiet', ref]) !== null) return ref;
  }
  throw new Error('cannot resolve a default main ref; pass --base explicitly');
}

function parseArgs(argv) {
  const options = { base: null, head: 'HEAD', files: [], format: 'text', workingTree: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') options.base = argv[++index] ?? '';
    else if (arg === '--head') options.head = argv[++index] ?? '';
    else if (arg === '--file') options.files.push(argv[++index] ?? '');
    else if (arg === '--files-from') options.files.push(...readFileSync(argv[++index] ?? '', 'utf8').split(/\r?\n/));
    else if (arg === '--stdin') options.files.push(...readFileSync(0, 'utf8').split(/\r?\n/));
    else if (arg === '--working-tree') options.workingTree = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown change-impact argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: scripts/hb.mjs change-impact [options]

  --base REF         compare from the merge base with REF (default upstream/main)
  --head REF         comparison head (default HEAD)
  --working-tree     include staged, unstaged and untracked paths
  --file PATH        classify an explicit path (repeatable)
  --files-from PATH  classify newline-separated paths
  --stdin            read newline-separated paths from stdin
  --json             emit machine-readable JSON`;
}

function changedFiles(options) {
  if (options.files.length) return options.files;
  const base = options.base || defaultBase();
  const mergeBase = git(['merge-base', options.head, base]);
  const files = git(['diff', '--name-only', '--no-renames', `${mergeBase}..${options.head}`]).split(/\r?\n/).filter(Boolean);
  if (options.workingTree) {
    files.push(...git(['diff', '--name-only', '--no-renames']).split(/\r?\n/).filter(Boolean));
    files.push(...git(['diff', '--cached', '--name-only', '--no-renames']).split(/\r?\n/).filter(Boolean));
    files.push(...git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean));
  }
  return files;
}

function printText(report) {
  console.log(`files: ${report.files.length}`);
  console.log(`categories: ${report.categories.join(', ') || 'none'}`);
  console.log('required checks:');
  for (const item of report.requiredChecks) console.log(`  - ${item.check}: ${item.command}`);
  for (const note of report.notes) console.log(`note: ${note}`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = classifyChanges(changedFiles(options));
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else printText(report);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`hb change-impact: ${error.message}`);
    process.exitCode = 1;
  }
}
