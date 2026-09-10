import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyChanges,
  classifyDeployedServiceChanges,
  committedDiff,
  verifyRequiredCheckResults,
} from '../../ci/change-impact.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const classifierSource = readFileSync(join(repoRoot, 'scripts/ci/change-impact.mjs'), 'utf8');

test('committed diff binds the complete ancestor-to-candidate commit set', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hb-impact-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'OPS-E Test');
    git('config', 'user.email', 'ops-e@example.invalid');
    writeFileSync(join(repo, 'first.md'), 'first\n');
    git('add', 'first.md');
    git('commit', '--quiet', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'second.ts'), 'export {};\n');
    git('add', 'second.ts');
    git('commit', '--quiet', '-m', 'second');
    const second = git('rev-parse', 'HEAD');
    assert.deepEqual(committedDiff(repo, first, second), ['second.ts']);
    assert.throws(() => committedDiff(repo, second, first), /ancestor/u);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('committed diff preserves both paths of a critical-to-docs rename and every deletion', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hb-impact-rename-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'OPS-E Test');
    git('config', 'user.email', 'ops-e@example.invalid');
    mkdirSync(join(repo, 'src/context'), { recursive: true });
    mkdirSync(join(repo, 'src/lib'), { recursive: true });
    writeFileSync(join(repo, 'src/context/AudioContext.tsx'), 'export const audio = true;\n');
    writeFileSync(join(repo, 'src/lib/removed.ts'), 'export const removed = true;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    mkdirSync(join(repo, 'docs/ops'), { recursive: true });
    git('mv', 'src/context/AudioContext.tsx', 'docs/ops/retired-component.md');
    git('rm', '--quiet', 'src/lib/removed.ts');
    git('commit', '--quiet', '-m', 'retire executable paths');

    assert.deepEqual(committedDiff(repo, base, 'HEAD'), [
      'docs/ops/retired-component.md',
      'src/context/AudioContext.tsx',
      'src/lib/removed.ts',
    ]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('working-tree discovery preserves old and new rename paths plus unstaged deletes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hb-impact-working-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'OPS-E Test');
    git('config', 'user.email', 'ops-e@example.invalid');
    mkdirSync(join(repo, 'src/context'), { recursive: true });
    mkdirSync(join(repo, 'src/lib'), { recursive: true });
    writeFileSync(join(repo, 'src/context/AudioContext.tsx'), 'export const audio = true;\n');
    writeFileSync(join(repo, 'src/lib/removed.ts'), 'export const removed = true;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');

    mkdirSync(join(repo, 'docs/ops'), { recursive: true });
    renameSync(join(repo, 'src/context/AudioContext.tsx'), join(repo, 'docs/ops/retired-component.md'));
    rmSync(join(repo, 'src/lib/removed.ts'));
    git('add', '--all');
    const output = execFileSync(process.execPath, [
      new URL('../../ci/change-impact.mjs', import.meta.url).pathname,
      '--repo', repo, '--base', 'HEAD', '--working-tree', '--json',
    ], { encoding: 'utf8' });
    const report = JSON.parse(output);

    assert.deepEqual(report.files, [
      'docs/ops/retired-component.md',
      'src/context/AudioContext.tsx',
      'src/lib/removed.ts',
    ]);
    assert.equal(report.risk, 'critical');
    assert.ok(report.deployment.servicesToReplace.includes('app'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const checkNames = (report) => report.requiredChecks.map(({ check }) => check);

test('documentation-only changes select no deployment or recovery ceremony', () => {
  const report = classifyChanges(['docs/ops/example.md']);
  assert.equal(report.schemaVersion, 'harmonic-beacon.change-impact.v2');
  assert.equal(report.risk, 'documentation');
  assert.deepEqual(report.domains, ['documentation']);
  assert.deepEqual(checkNames(report), ['diff-check']);
  assert.deepEqual(report.deployment, {
    deploy: false,
    artifactsToPull: [],
    servicesToReplace: [],
    reusePriorImages: [],
    migration: 'never',
    recovery: 'none',
  });
});

test('bounded CSS selects the explicit UI matrix and only replaces app', () => {
  const report = classifyChanges(['src/app/landing.css']);
  assert.equal(report.risk, 'ui');
  assert.deepEqual(report.matrices.ui, [
    'component', 'chromium-android-responsive', 'affected-visual',
  ]);
  assert.deepEqual(report.matrices.functional, []);
  assert.deepEqual(report.matrices.critical, []);
  assert.deepEqual(report.deployment, {
    deploy: true,
    artifactsToPull: ['app'],
    servicesToReplace: ['app'],
    reusePriorImages: [],
    migration: 'never',
    recovery: 'image-config',
  });
});

test('functional service changes select only their service and domain journey', () => {
  const report = classifyChanges(['services/tapestry/src/server.mjs']);
  assert.equal(report.risk, 'functional');
  assert.deepEqual(report.domains, ['tapestry']);
  assert.deepEqual(report.deployment.artifactsToPull, ['tapestry']);
  assert.deepEqual(report.deployment.servicesToReplace, ['tapestry']);
  assert.ok(report.matrices.functional.includes('tapestry-integration'));
});

test('audio auth grants payments and data retain explicit critical matrices', () => {
  const fixtures = new Map([
    ['src/context/AudioContext.tsx', 'audio'],
    ['src/lib/auth.ts', 'auth'],
    ['src/lib/stage-grant-effects.ts', 'grants'],
    ['src/lib/commerce-entitlement.ts', 'payments'],
    ['prisma/migrations/20260910120000_example/migration.sql', 'data'],
  ]);
  for (const [path, domain] of fixtures) {
    const report = classifyChanges([path]);
    assert.equal(report.risk, 'critical', path);
    assert.ok(report.domains.includes(domain), path);
    assert.ok(report.matrices.critical.some((entry) => entry.startsWith(`${domain}:`)), path);
    assert.ok(report.matrices.crossDomain.includes('required-check-completeness'), path);
  }
  const data = classifyChanges([...fixtures.keys()]);
  assert.equal(data.deployment.migration, 'verify-pending');
  assert.equal(data.deployment.recovery, 'backup-restore-if-pending');
  assert.ok(data.deployment.servicesToReplace.includes('commerce-reconciler'));
});

test('shared dependencies affect every first-party artifact and service role', () => {
  const report = classifyChanges(['package-lock.json']);
  assert.deepEqual(report.deployment.artifactsToPull, ['app', 'playlist-bot', 'tapestry']);
  assert.deepEqual(report.deployment.servicesToReplace, [
    'app', 'commerce-reconciler', 'playlist-bot', 'tapestry',
  ]);
  assert.deepEqual(report.requiredJobChecks, [
    'impact', 'lint-and-build', 'test', 'tapestry', 'playlist', 'analytics',
  ]);
});

test('shared app runtime modules replace both actual consumers of the app artifact', () => {
  const report = classifyChanges(['src/lib/db.ts']);
  assert.deepEqual(report.deployment.artifactsToPull, ['app']);
  assert.deepEqual(report.deployment.servicesToReplace, ['app', 'commerce-reconciler']);
  assert.ok(report.requiredJobChecks.includes('lint-and-build'));
  assert.ok(report.requiredJobChecks.includes('test'));
});

test('every selected service or functional matrix contributes its CI job check', () => {
  const fixtures = [
    ['services/tapestry/src/server.mjs', 'tapestry'],
    ['services/playlist-bot/src/index.mjs', 'playlist'],
    ['services/analytics/src/worker.mjs', 'analytics'],
  ];
  for (const [path, job] of fixtures) {
    const report = classifyChanges([path]);
    assert.ok(report.requiredJobChecks.includes(job), `${path} must require ${job}`);
  }
});

test('unknown paths expand to every matrix and service without guessing a migration', () => {
  const report = classifyChanges(['mystery/runtime.xyz']);
  assert.equal(report.risk, 'critical');
  assert.deepEqual(report.domains, ['audio', 'auth', 'data', 'grants', 'payments', 'unknown']);
  assert.ok(report.matrices.ui.length > 0);
  assert.ok(report.matrices.functional.length > 0);
  assert.ok(report.matrices.critical.length >= 5);
  assert.deepEqual(report.deployment.servicesToReplace, [
    'app', 'commerce-reconciler', 'playlist-bot', 'tapestry',
  ]);
  assert.equal(report.deployment.migration, 'verify-pending');
  assert.deepEqual(report.details.unclassifiedPaths, ['mystery/runtime.xyz']);
});

test('analytics changes keep their matrix but never enter the Live root-helper lane', () => {
  const report = classifyChanges(['services/analytics/src/worker.mjs']);
  assert.ok(report.matrices.functional.includes('analytics-contract'));
  assert.equal(report.deployment.deploy, false);
  assert.deepEqual(report.deployment.artifactsToPull, []);
  assert.deepEqual(report.deployment.servicesToReplace, []);
  assert.deepEqual(report.requiredChecks.map(({ check }) => check), ['diff-check', 'analytics']);
});

test('bounded UI retains app checks while service-only changes avoid unrelated app ceremony', () => {
  const ui = classifyChanges(['src/app/globals.css']);
  assert.deepEqual(ui.requiredChecks.map(({ check }) => check), ['diff-check', 'lint-and-build', 'test', 'e2e']);
  const tapestry = classifyChanges(['services/tapestry/src/renderer.ts']);
  assert.deepEqual(tapestry.requiredChecks.map(({ check }) => check), ['diff-check', 'tapestry']);
});

test('runtime config replaces app with its prior image and never selects an app rebuild artifact', () => {
  const report = classifyChanges(['deploy/runtime-public-config/production.json']);
  assert.deepEqual(report.deployment.servicesToReplace, ['app']);
  assert.deepEqual(report.deployment.artifactsToPull, []);
  assert.deepEqual(report.deployment.reusePriorImages, ['app']);
  assert.equal(report.deployment.migration, 'never');
  assert.equal(report.deployment.recovery, 'image-config');
});

test('labels can add detected risk but can never downgrade it', () => {
  const detected = classifyChanges(['src/lib/auth.ts'], { labels: ['impact:documentation', 'impact:ui'] });
  assert.equal(detected.risk, 'critical');
  assert.ok(detected.domains.includes('auth'));
  assert.ok(detected.matrices.critical.includes('auth:oidc-cookie-logout'));

  const added = classifyChanges(['src/app/landing.css'], { labels: ['impact:payments'] });
  assert.equal(added.risk, 'critical');
  assert.ok(added.domains.includes('payments'));
  assert.ok(added.matrices.critical.includes('payments:commerce-sandbox'));
});

test('deployed service bases include accumulated undeployed and shared changes', () => {
  const report = classifyDeployedServiceChanges({
    labels: [],
    diffByService: {
      app: ['src/app/page.tsx', 'package-lock.json'],
      tapestry: ['package-lock.json'],
      'playlist-bot': ['package-lock.json'],
      analytics: ['package-lock.json'],
      'commerce-reconciler': ['package-lock.json'],
    },
    serviceReleases: {
      app: { sourceSha: 'a'.repeat(40) },
      tapestry: { sourceSha: 'b'.repeat(40) },
      'playlist-bot': { sourceSha: 'b'.repeat(40) },
      analytics: { sourceSha: 'b'.repeat(40) },
      'commerce-reconciler': { sourceSha: 'a'.repeat(40) },
    },
  });
  assert.deepEqual(report.files, ['package-lock.json', 'src/app/page.tsx']);
  assert.equal(report.details.deployedServiceBases.app, 'a'.repeat(40));
  assert.equal(report.details.deployedServiceBases.tapestry, 'b'.repeat(40));
  assert.deepEqual(report.deployment.servicesToReplace, [
    'app', 'commerce-reconciler', 'playlist-bot', 'tapestry',
  ]);
});

test('an unknown accumulated path expands every Live service even when only one base sees it', () => {
  const report = classifyDeployedServiceChanges({
    labels: [],
    diffByService: {
      app: ['mystery/runtime.xyz'],
      tapestry: [],
      'playlist-bot': [],
      analytics: [],
      'commerce-reconciler': [],
    },
    serviceReleases: {
      app: { sourceSha: 'a'.repeat(40) },
      tapestry: { sourceSha: 'b'.repeat(40) },
      'playlist-bot': { sourceSha: 'b'.repeat(40) },
      analytics: { sourceSha: 'b'.repeat(40) },
      'commerce-reconciler': { sourceSha: 'b'.repeat(40) },
    },
  });
  assert.deepEqual(report.deployment.servicesToReplace, [
    'app', 'commerce-reconciler', 'playlist-bot', 'tapestry',
  ]);
});

test('required check verification rejects missing failed cancelled and skipped results', () => {
  const required = ['diff-check', 'auth-contract'];
  assert.deepEqual(verifyRequiredCheckResults(required, [
    { check: 'diff-check', conclusion: 'success' },
    { check: 'auth-contract', conclusion: 'success' },
  ]), required);
  for (const results of [
    [{ check: 'diff-check', conclusion: 'success' }],
    [{ check: 'diff-check', conclusion: 'success' }, { check: 'auth-contract', conclusion: 'failure' }],
    [{ check: 'diff-check', conclusion: 'success' }, { check: 'auth-contract', conclusion: 'cancelled' }],
    [{ check: 'diff-check', conclusion: 'success' }, { check: 'auth-contract', conclusion: 'skipped' }],
  ]) {
    assert.throws(() => verifyRequiredCheckResults(required, results), /required check/u);
  }
});

test('protected delivery contexts stay bound to the selected impact matrix', () => {
  assert.deepEqual(classifyChanges(['README.md']).requiredContexts, ['diff-check']);
  assert.deepEqual(
    classifyChanges(['src/app/page.tsx']).requiredContexts,
    ['diff-check', 'lint-and-build', 'test', 'e2e', 'account'],
  );
  assert.deepEqual(
    classifyChanges(['src/app/api/playback/route.ts']).requiredContexts,
    ['diff-check', 'lint-and-build', 'test', 'e2e', 'account', 'frozen-audio-paths'],
  );
});

test('delivery-control changes conservatively require every protected context', () => {
  assert.deepEqual(classifyChanges(['.github/workflows/oci-promote.yml']).requiredContexts, [
    'diff-check', 'lint-and-build', 'test', 'tapestry', 'playlist', 'analytics',
    'e2e', 'account', 'frozen-audio-paths',
  ]);
});

test('hashed commerce contract markdown keeps contract validation without app expansion', () => {
  const report = classifyChanges(['contracts/commerce-entitlement/CONTRACT.md']);
  assert.equal(report.risk, 'documentation');
  assert.deepEqual(checkNames(report), ['diff-check', 'commerce-contract']);
  assert.deepEqual(report.requiredContexts, ['diff-check', 'test']);
});

test('agent skill distributions execute inside the always-run impact job while delivery keeps stable contexts', () => {
  const report = classifyChanges(['.agents/skills/github-workflows/SKILL.md']);
  assert.deepEqual(checkNames(report), ['diff-check', 'agent-skill-distributions']);
  assert.deepEqual(report.requiredContexts, ['diff-check']);
});

test('rename detection remains disabled so both paths are classified', () => {
  assert.match(classifierSource, /\['diff', '--no-renames', '--name-only'/u);
});

test('explicit human-review labels fail closed', () => {
  const report = classifyChanges(['src/app/page.tsx'], { labels: ['requires-human-review'] });
  assert.equal(report.humanReviewRequired, true);
  assert.match(report.humanReviewReason, /requires-human-review/u);
});

test('the executable CI verifier rejects a selected matrix job that was skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-impact-results-'));
  try {
    const impactPath = join(root, 'impact.json');
    const resultsPath = join(root, 'results.json');
    const report = classifyChanges(['package-lock.json']);
    writeFileSync(impactPath, JSON.stringify(report));
    const results = report.requiredJobChecks.map((check) => ({ check, conclusion: 'success' }));
    writeFileSync(resultsPath, JSON.stringify(results));
    const verifier = new URL('../../ci/change-impact.mjs', import.meta.url).pathname;
    assert.doesNotThrow(() => execFileSync(process.execPath, [
      verifier, 'verify-results', '--impact', impactPath, '--results', resultsPath,
    ], { encoding: 'utf8' }));
    writeFileSync(resultsPath, JSON.stringify(results.map((entry) =>
      entry.check === 'analytics' ? { ...entry, conclusion: 'skipped' } : entry)));
    assert.throws(() => execFileSync(process.execPath, [
      verifier, 'verify-results', '--impact', impactPath, '--results', resultsPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), /Command failed/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
