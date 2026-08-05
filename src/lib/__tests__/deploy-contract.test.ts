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

  it('builds, replaces and waits for tapestry in every release', () => {
    const normalizedHelper = rootHelper.replace(/\\\n\s*/g, '');

    expect(rootHelper).toMatch(/build app tapestry/);
    expect(normalizedHelper).toContain(
      'up -d --no-deps --force-recreate app commerce-reconciler tapestry',
    );
    expect(workflow).toContain('tapestry_health=');
    expect(workflow).toContain('[ "$tapestry_health" = healthy ]');
  });

  it('embeds and verifies the exact release provenance before success', () => {
    expect(compose).toContain('BEACON_GIT_SHA=${BEACON_GIT_SHA:-unknown}');
    expect(compose).toContain('BEACON_BUILD_TIME=${BEACON_BUILD_TIME:-unknown}');
    expect(compose).toContain(
      'BEACON_DATABASE_SCHEMA_VERSION=${BEACON_DATABASE_SCHEMA_VERSION:-unknown}',
    );
    expect(rootHelper).toContain('BEACON_GIT_SHA="$sha"');
    expect(workflow).toContain('EXPECTED_GIT_SHA="$GITHUB_SHA"');
    expect(workflow).toContain('health?.gitSha !== process.env.EXPECTED_GIT_SHA');
    expect(workflow).toContain('https://live.harmonicbeacon.com/api/health');
  });

  it('can only schedule production deploys on the verified mona runner', () => {
    expect(workflow).toContain('runs-on: [self-hosted, mona]');
    expect(workflow).toContain('test "$(hostname -s)" = mona');
    expect(workflow).toContain('test "$(id -un)" = beacon-runner');
    expect(workflow).toContain(
      'cmp --silent deploy/hb-deploy-root /usr/local/sbin/hb-deploy',
    );
    expect(workflow).not.toMatch(/runs-on:\s+self-hosted\s*$/m);
  });

  it('keeps pull-request code off every self-hosted production runner', () => {
    for (const pullRequestWorkflow of [ciWorkflow, audioBoundaryWorkflow]) {
      expect(pullRequestWorkflow).toContain('runs-on: ubuntu-latest');
      expect(pullRequestWorkflow).not.toMatch(/runs-on:.*self-hosted/);
    }
    expect(workflow).toContain('runs-on: [self-hosted, mona]');
  });

  it('normalizes Docker network templates before the centralized exact membership check', () => {
    expect(rootHelper).toContain("sed '/^[[:space:]]*$/d'");
    expect(rootHelper).toContain("readonly EXPECTED_NETWORK_MEMBERS=$'beacon-app\\npmp-myth-worker\\npmp-myth-worker-secondary'");
    expect(rootHelper).toContain("die 'commerce network is not internal'");
  });

  it('refuses a production deploy while the passwordless E2E dashboard is enabled', () => {
    expect(rootHelper).toContain(
      "grep -Fxq 'E2E_DASHBOARD_ENABLED=1' \"$PRODUCTION_ENV\"",
    );
    expect(rootHelper).toContain(
      "die 'production E2E dashboard must be disabled before deploy'",
    );
    expect(workflow).toContain(
      'https://live.harmonicbeacon.com/api/test-login',
    );
    expect(workflow).toContain(
      'Production test-login $method returned $code instead of 404',
    );
  });

  it('preserves and restores app and tapestry independently', () => {
    expect(rootHelper).toContain(
      'harmonic-beacon/app:rollback-${run_id}',
    );
    expect(rootHelper).toContain(
      'harmonic-beacon/tapestry:rollback-${run_id}',
    );
    expect(workflow).toContain(
      'steps.rollback.outputs.app_available == \'true\'',
    );
    expect(workflow).toContain(
      'steps.rollback.outputs.tapestry_available == \'true\'',
    );
    expect(rootHelper).toContain('worker_expected=true');
    expect(rootHelper).toContain('[ "$tapestry_ready" = true ]');
  });

  it('funnels every privileged workflow operation through the validated helper', () => {
    const privilegedLines = workflow
      .split('\n')
      .filter((line) => line.includes('sudo -n'));

    expect(privilegedLines.length).toBeGreaterThan(0);
    expect(
      privilegedLines.every((line) =>
        line.includes('sudo -n /usr/local/sbin/hb-deploy'),
      ),
    ).toBe(true);
    expect(workflow).not.toMatch(/sudo -n (?:env |docker |test |stat )/);
    expect(rootHelper).toContain('[ "${EUID}" -eq 0 ]');
    expect(rootHelper).toContain(
      "readonly WORKSPACE='/opt/actions-runner/_work/harmonic-beacon-webapp/harmonic-beacon-webapp'",
    );
    expect(rootHelper).toContain("[[ \"$1\" =~ ^[0-9a-f]{40}$ ]]");
    expect(rootHelper).toContain("die 'workspace has tracked changes'");
    expect(rootHelper).toContain("die 'workspace index has tracked changes'");
    expect(
      rootHelper.match(
        /docker compose --file "\$workspace\/docker-compose\.yml"/g,
      ),
    ).toHaveLength(2);
    expect(rootHelper).not.toMatch(/\beval\b|\bbash -c\b|\bsh -c\b/);
    expect(
      statSync(join(process.cwd(), 'deploy/hb-deploy-root')).mode & 0o111,
    ).not.toBe(0);
  });

  it('grants the runner no generic sudo or direct Docker command', () => {
    expect(runnerSudoers).toContain(
      'Cmnd_Alias HARMONIC_BEACON_DEPLOY = /usr/local/sbin/hb-deploy *',
    );
    expect(runnerSudoers).toContain(
      'beacon-runner ALL=(root) NOPASSWD: HARMONIC_BEACON_DEPLOY',
    );
    expect(runnerSudoers).not.toContain('NOPASSWD: ALL');
    expect(runnerSudoers).not.toMatch(/\/(?:usr\/bin\/)?docker\b/);
  });

  it('audits the production dependencies of both deployable packages', () => {
    for (const contents of [ciWorkflow, workflow]) {
      expect(contents).toContain('npm audit --omit=dev --audit-level=high');
      expect(contents).toContain(
        'npm audit --omit=dev --prefix services/tapestry --audit-level=high',
      );
      expect(contents).toContain(
        'npm audit --omit=dev --prefix services/playlist-bot --audit-level=high',
      );
    }
  });
});
