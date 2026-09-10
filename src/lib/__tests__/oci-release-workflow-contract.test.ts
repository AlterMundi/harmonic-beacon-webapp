import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('immutable OCI candidate and promotion contract', () => {
    it('builds and signs only trusted integrated main candidates on a hosted runner', () => {
        const workflow = read('.github/workflows/oci-candidate.yml');
        expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).not.toMatch(/^\s+pull_request:/m);
        expect(workflow).toContain('runs-on: ubuntu-24.04');
        expect(workflow).toContain('contents: read');
        expect(workflow).toContain('packages: write');
        expect(workflow).not.toContain('attestations: write');
        expect(workflow).toContain('id-token: write');
        expect(workflow).toContain('push: true');
        expect(workflow).toContain('provenance: mode=max');
        expect(workflow).toContain('sbom: true');
        expect(workflow).toContain('cosign sign --yes');
        expect(workflow).toContain('scripts/ci/release-manifest.mjs');
        expect(workflow).toContain('scripts/ci/qualify-oci.mjs');
        expect(workflow).toContain('--no-build');
        expect(workflow).not.toContain('pull_request_target');
        expect(workflow).not.toContain('test "$GITHUB_EVENT_NAME" = workflow_dispatch -o');
        expect(workflow).toContain('test "$GITHUB_REF" = refs/heads/main');
        for (const use of workflow.matchAll(/uses:\s+[^\s]+@([^\s]+)/g)) {
            expect(use[1]).toMatch(/^[0-9a-f]{40}$/);
        }
    });

    it('promotes an exact qualified run and manifest hash without executing candidate code or rebuilding', () => {
        const workflow = read('.github/workflows/oci-promote.yml');
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain('candidate_run_id:');
        expect(workflow).toContain('manifest_sha256:');
        expect(workflow).toContain('target:');
        expect(workflow).toContain('actions: read');
        expect(workflow).not.toContain('packages: read');
        expect(workflow).not.toContain('packages: write');
        expect(workflow).toContain('runs-on: [self-hosted, mona]');
        expect(workflow).toContain('test "$(hostname -s)" = mona');
        expect(workflow).toContain('test "$(id -un)" = beacon-runner');
        expect(workflow).toContain("vars.HB_RELEASE_LANE_STATE == 'oci-production'");
        expect(workflow).toContain("vars.HB_RELEASE_LANE_STATE == 'legacy-shadow'");
        expect(workflow).toContain('hb-deploy artifact-prepare');
        expect(workflow).toContain('hb-deploy artifact-preflight');
        expect(workflow).toContain('hb-deploy artifact-status');
        expect(workflow).not.toMatch(/\b(?:docker|buildx)\s+build\b|docker\s+compose\s+build|npm\s+(?:ci|test|run\s+build|run\s+lint)/);
        expect(workflow).not.toContain('pull_request_target');
    });

    it('pins build inputs and overlays every runtime role with exact digest references', () => {
        const bake = read('docker-bake.hcl');
        const overlay = read('deploy/oci-images.compose.yml');
        const qualification = read('deploy/qualification.compose.yml');
        expect(bake).toContain('platforms = ["linux/amd64"]');
        expect(bake).toContain('org.opencontainers.image.revision');
        expect(bake).not.toContain('NEXT_PUBLIC_LIVEKIT_URL');
        for (const target of ['app', 'tapestry', 'playlist-bot', 'analytics']) {
            expect(bake).toContain(`target "${target}"`);
        }
        expect(overlay.match(/image: \$\{HB_APP_IMAGE_REF:\?exact app digest required\}/g)).toHaveLength(3);
        for (const variable of [
            'HB_TAPESTRY_IMAGE_REF', 'HB_PLAYLIST_IMAGE_REF', 'HB_ANALYTICS_IMAGE_REF',
            'HB_LIVEKIT_IMAGE_REF', 'HB_POSTGRES_IMAGE_REF',
        ]) expect(overlay).toContain(variable);
        expect(qualification).toContain('HB_APP_IMAGE_REF');
        expect(qualification).toContain('LIVEKIT_PUBLIC_URL');
        expect(qualification).not.toContain('/etc/harmonic-beacon/production.env');
        expect(qualification).not.toContain('/mnt/beacon-data/postgres');
    });

    it('keeps the root helper typed, digest-only and no-build while preserving the legacy shadow fallback', () => {
        const helper = read('deploy/hb-deploy-root');
        const legacyWorkflow = read('.github/workflows/deploy.yml');
        const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        const promotion = helper.slice(helper.indexOf('artifact_prepare() {'));
        const legacy = helper.slice(0, helper.indexOf('artifact_prepare() {'));
        const deployReadme = read('deploy/README.md');
        expect(helper).toContain("readonly ARTIFACT_VERIFY='/usr/local/libexec/harmonic-beacon/hb-artifact-verify'");
        for (const command of [
            'artifact-prepare', 'artifact-preflight', 'artifact-migrate',
            'artifact-replace', 'artifact-status', 'artifact-rollback',
        ]) expect(helper).toContain(command);
        expect(promotion).toContain('--no-build');
        expect(promotion).toContain('--pull never');
        expect(promotion).not.toMatch(/docker compose[^\n]*\bbuild\b|\bbuild\(\)/);
        expect(legacy).toContain('build() {');
        expect(legacyWorkflow).toContain("vars.HB_RELEASE_LANE_STATE != 'oci-production'");
        expect(packageJson.scripts['test:ops-tooling']).toContain('scripts/ci/__tests__');
        expect(deployReadme).toContain('shadow fallback');
        expect(deployReadme).toContain('never an authorized direct-Compose fallback');
    });
});
