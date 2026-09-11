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
        const rollback = helper.slice(helper.indexOf('artifact_rollback() {'), helper.indexOf('\nusage() {'));
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
