import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepositoryFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('production deploy contract', () => {
  const compose = readRepositoryFile('docker-compose.yml');
  const ciWorkflow = readRepositoryFile('.github/workflows/ci.yml');
  const audioBoundaryWorkflow = readRepositoryFile(
    '.github/workflows/audio-boundary.yml',
  );
  const e2eWorkflow = readRepositoryFile('.github/workflows/e2e.yml');
  const workflow = readRepositoryFile('.github/workflows/deploy.yml');
  const rootHelper = readRepositoryFile('deploy/hb-deploy-root');
  const runnerSudoers = readRepositoryFile('deploy/beacon-runner.sudoers');

  it('gives app and tapestry independent commit-tagged images', () => {
    expect(compose).toContain(
      'image: harmonic-beacon/app:${BEACON_IMAGE_TAG:-latest}',
    );
    expect(compose).toContain(
      'image: harmonic-beacon/tapestry:${BEACON_IMAGE_TAG:-latest}',
    );
  });

  it('holds legacy source deployment closed without scheduling Mona or executing code', () => {
    expect(workflow).toContain('safety-hold:');
    expect(workflow).toContain('exit 1');
    expect(workflow).not.toMatch(/sudo|self-hosted|uses:|npm /);
    expect(rootHelper).not.toMatch(/^(?:build|replace|preserve|migrate|quiesce|rollback|legacy_admit)\(\)/m);
  });

  it('verifies OCI release provenance before publication', () => {
    expect(rootHelper).toContain('verify_public_provenance_from');
    expect(rootHelper).toContain('.gitSha==$sha and .artifactDigest==$artifact');
    expect(rootHelper).toContain('verify_release_runtime_state "$run_id" candidate');
  });

  it('schedules OCI promotion on the verified dedicated runner', () => {
    const promotion = readRepositoryFile('.github/workflows/oci-promote.yml');
    expect(promotion).toContain('runs-on: [self-hosted, mona]');
    expect(promotion).toContain('test "$(hostname -s)" = mona');
    expect(promotion).toContain('test "$(id -un)" = beacon-runner');
    expect(promotion).toContain('sudo /usr/local/sbin/hb-deploy artifact-impact-state > impact-state.json');
    expect(promotion).toContain('cmp --silent impact-plan.json hosted-impact-plan.json');
    expect(promotion).not.toContain('cmp --silent deploy/hb-deploy-root /usr/local/sbin/hb-deploy');
  });

  it('retains browser qualification while legacy release is held', () => {
    expect(e2eWorkflow).toContain('workflow_call:');
    expect(workflow).toContain('exit 1');
    expect(readRepositoryFile('.github/workflows/oci-candidate.yml')).toContain('scripts/ci/qualify-oci.mjs');
  });

  it('keeps pull-request code off every self-hosted production runner', () => {
    for (const pullRequestWorkflow of [ciWorkflow, audioBoundaryWorkflow]) {
      expect(pullRequestWorkflow).toContain('runs-on: ubuntu-latest');
      expect(pullRequestWorkflow).not.toMatch(/runs-on:.*self-hosted/);
    }
    expect(workflow).not.toContain('self-hosted');
  });

  it('normalizes Docker network templates before the centralized exact membership check', () => {
    expect(rootHelper).toContain("sed '/^[[:space:]]*$/d'");
    expect(rootHelper).toContain("readonly EXPECTED_NETWORK_MEMBERS=$'beacon-app\\npmp-myth-worker\\npmp-myth-worker-secondary'");
    expect(rootHelper).toContain("die 'commerce network is not internal'");
  });

  it('checks the production private boundary through the root-owned helper', () => {
    expect(rootHelper).toContain('boundary() {');
    expect(rootHelper).toContain('E2E_DASHBOARD_ENABLED');
    expect(rootHelper).toContain('require_exact_private_network');
  });

  it('restores the manifest-bound OCI service set', () => {
    expect(rootHelper).toContain('artifact_compose_service_from "$run_id" prior "$service" up -d --no-deps --force-recreate --no-build --pull never');
    expect(rootHelper).toContain('verify_release_runtime_state "$run_id" prior');
  });

  it('admits fixed files without privileged repository inspection or workspace execution', () => {
    expect(rootHelper).toContain('[ "${EUID}" -eq 0 ]');
    expect(rootHelper).toContain('admit_file');
    expect(rootHelper).toContain('--file "$root/oci-images.compose.yml"');
    expect(rootHelper).toContain(
      "readonly CANDIDATE_PARENT='/opt/actions-runner/_work/harmonic-beacon-webapp/harmonic-beacon-webapp/.hb-artifacts'",
    );
    expect(rootHelper).toContain('artifact_impact_state() {');
    expect(rootHelper).not.toMatch(/\b(?:git|runuser)\b/);
    expect(rootHelper).not.toContain('readonly WORKSPACE=');
    expect(rootHelper).not.toContain('readonly RUNNER_USER=');
    expect(rootHelper).toContain(
      'args=(docker compose --file "$1" --file "$2" --project-name app --env-file "$3")',
    );
    expect(rootHelper).not.toMatch(/\beval\b/);
    expect(
      statSync(join(process.cwd(), 'deploy/hb-deploy-root')).mode & 0o111,
    ).not.toBe(0);
  });

  it('grants the runner no generic sudo or direct Docker command', () => {
    expect(runnerSudoers).toContain(
      '/usr/local/sbin/hb-deploy artifact-prepare *',
    );
    expect(runnerSudoers).toContain(
      'beacon-runner ALL=(root) NOPASSWD:NOSETENV: HARMONIC_BEACON_DEPLOY',
    );
    expect(runnerSudoers).not.toContain('NOPASSWD: ALL');
    expect(runnerSudoers).not.toMatch(/\/(?:usr\/bin\/)?docker\b/);
  });

  it('audits the production dependencies of both deployable packages', () => {
    for (const contents of [ciWorkflow]) {
      expect(contents).toContain('npm run audit:production');
      expect(contents).toContain(
        'npm audit --omit=dev --prefix services/tapestry --audit-level=high',
      );
      expect(contents).toContain(
        'npm audit --omit=dev --prefix services/playlist-bot --audit-level=high',
      );
    }
  });
});
