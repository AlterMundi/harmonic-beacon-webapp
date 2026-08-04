import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepositoryFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('production deploy contract', () => {
  const compose = readRepositoryFile('docker-compose.yml');
  const ciWorkflow = readRepositoryFile('.github/workflows/ci.yml');
  const workflow = readRepositoryFile('.github/workflows/deploy.yml');

  it('gives app and tapestry independent commit-tagged images', () => {
    expect(compose).toContain(
      'image: harmonic-beacon/app:${BEACON_IMAGE_TAG:-latest}',
    );
    expect(compose).toContain(
      'image: harmonic-beacon/tapestry:${BEACON_IMAGE_TAG:-latest}',
    );
  });

  it('builds, replaces and waits for tapestry in every release', () => {
    expect(workflow).toMatch(/build app tapestry/);
    expect(workflow).toMatch(
      /up -d --no-deps --force-recreate app commerce-reconciler tapestry/,
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
    expect(workflow).toContain('BEACON_GIT_SHA="$GITHUB_SHA"');
    expect(workflow).toContain('EXPECTED_GIT_SHA="$GITHUB_SHA"');
    expect(workflow).toContain('health?.gitSha !== process.env.EXPECTED_GIT_SHA');
    expect(workflow).toContain('https://live.harmonicbeacon.com/api/health');
  });

  it('can only schedule production deploys on the verified mona runner', () => {
    expect(workflow).toContain('runs-on: [self-hosted, mona]');
    expect(workflow).toContain('test "$(hostname -s)" = mona');
    expect(workflow).not.toMatch(/runs-on:\s+self-hosted\s*$/m);
  });

  it('preserves and restores app and tapestry independently', () => {
    expect(workflow).toContain(
      'harmonic-beacon/app:rollback-${GITHUB_RUN_ID}',
    );
    expect(workflow).toContain(
      'harmonic-beacon/tapestry:rollback-${GITHUB_RUN_ID}',
    );
    expect(workflow).toContain(
      'steps.rollback.outputs.app_available == \'true\'',
    );
    expect(workflow).toContain(
      'steps.rollback.outputs.tapestry_available == \'true\'',
    );
    expect(workflow).toContain('worker_expected=true');
    expect(workflow).toContain('[ "$tapestry_ready" = true ]');
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
