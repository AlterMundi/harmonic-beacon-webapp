import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('production operational entrypoints', () => {
    it('ships the complete local module closure used by raw tsx commands', () => {
        const dockerfile = readFileSync('Dockerfile', 'utf8');
        expect(dockerfile).toContain('/app/src/lib ./src/lib');
        expect(dockerfile).toContain('/app/scripts/commerce-media-worker.ts');
        expect(dockerfile).toContain('/app/scripts/weekend-stabilize.ts');
        expect(dockerfile).toContain('/app/scripts/stage-grant-rollback-preflight.ts');
        expect(dockerfile).toContain('/app/scripts/release-quiesce-preflight.ts');
        expect(dockerfile).toContain('/app/scripts/stage-grant-forward-drain.ts');
    });

    it('exposes an import-only worker smoke without opening external services', () => {
        const worker = readFileSync('scripts/commerce-media-worker.ts', 'utf8');
        expect(worker).toContain("BEACON_WORKER_IMPORT_SMOKE === '1'");
        expect(worker).toContain('runtime imports loaded');
    });

    it('keeps enough memory headroom for the durable grant worker to warm up', () => {
        const compose = readFileSync('docker-compose.yml', 'utf8');
        const reconciler = compose.slice(
            compose.indexOf('  commerce-reconciler:'),
            compose.indexOf('\n  # ── Playlist bot'),
        );

        expect(reconciler).toContain('memory: 512M');
        expect(reconciler).not.toContain('memory: 256M');
    });

    it('fences and fully quiesces writers around automatic application rollback', () => {
        const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
        const rollback = helper.slice(helper.indexOf('artifact_rollback() {'), helper.indexOf('\nschedule_apply() {'));
        const initialPreflight = rollback.indexOf('run_release_continuity_preflight');
        const fence = rollback.indexOf('entry_fence_acquire');
        const stopWriters = rollback.indexOf('stop app commerce-reconciler');
        const finalPreflight = rollback.indexOf('run_release_continuity_preflight', initialPreflight + 1);
        const durablePreflight = rollback.indexOf('stage-grant-rollback-preflight.ts');
        const restore = rollback.indexOf('artifact_compose_service_from');
        const release = rollback.indexOf('entry_fence_release');

        expect(initialPreflight).toBeGreaterThan(-1);
        expect(fence).toBeGreaterThan(initialPreflight);
        expect(stopWriters).toBeGreaterThan(fence);
        expect(finalPreflight).toBeGreaterThan(stopWriters);
        expect(durablePreflight).toBeGreaterThan(finalPreflight);
        expect(restore).toBeGreaterThan(durablePreflight);
        expect(release).toBeGreaterThan(restore);
        expect(rollback).toContain('automatic rollback refused: durable grant state did not quiesce');
        expect(rollback).toContain('transaction_require_rollback');
    });

    it('quiesces writers and drains forward grant upgrades before replacement', () => {
        const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
        const migrate = helper.slice(helper.indexOf('artifact_migrate() {'), helper.indexOf('artifact_replace() {'));
        expect(migrate.indexOf('migration-attempted')).toBeLessThan(migrate.indexOf('stop app'));
        expect(migrate.indexOf('release-quiesce-preflight.ts')).toBeLessThan(migrate.indexOf('npx prisma migrate deploy'));
        expect(migrate.indexOf('stage-grant-forward-drain.ts')).toBeGreaterThan(migrate.indexOf('npx prisma migrate deploy'));
        expect(migrate).toContain('--no-build --pull never');
    });
});
