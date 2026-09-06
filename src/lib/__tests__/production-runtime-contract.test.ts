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

    it('quiesces and preflights before any automatic application rollback', () => {
        const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
        const rollback = helper.slice(helper.indexOf('rollback() {'), helper.indexOf('\nusage() {'));
        const stopApp = rollback.indexOf('stop app');
        const preflight = rollback.indexOf('stage-grant-rollback-preflight.ts');
        const stopWorker = rollback.indexOf('docker stop beacon-commerce-reconciler');
        const compatible = rollback.indexOf('/app/src/lib/stage-grant-effects.ts');
        const restore = rollback.indexOf('app commerce-reconciler');

        expect(stopApp).toBeGreaterThan(-1);
        expect(preflight).toBeGreaterThan(stopApp);
        expect(stopWorker).toBeGreaterThan(preflight);
        expect(compatible).toBeGreaterThan(stopWorker);
        expect(restore).toBeGreaterThan(compatible);
        expect(rollback).toContain('automatic rollback refused: previous app lacks durable grant contract');
        expect(rollback).toContain('[ "$migration_attempted" = true ]');
        expect(rollback).toContain('failures before a migration attempt never changed');
    });

    it('quiesces writers and drains forward grant upgrades before replacement', () => {
        const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
        const quiesce = workflow.indexOf('hb-deploy quiesce');
        const migrationAttempt = workflow.indexOf("echo 'attempted=true'");
        const migrate = workflow.indexOf('hb-deploy migrate');
        const replace = workflow.indexOf('hb-deploy replace');
        const helper = readFileSync('deploy/hb-deploy-root', 'utf8');

        expect(quiesce).toBeGreaterThan(-1);
        expect(migrationAttempt).toBeGreaterThan(quiesce);
        expect(migrate).toBeGreaterThan(migrationAttempt);
        expect(replace).toBeGreaterThan(migrate);
        expect(helper).toContain('scripts/release-quiesce-preflight.ts');
        expect(helper).toContain('scripts/stage-grant-forward-drain.ts');
        expect(workflow).toContain("always() && (failure() || cancelled())");
    });
});
