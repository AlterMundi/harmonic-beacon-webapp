import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('production operational entrypoints', () => {
    it('ships the complete local module closure used by raw tsx commands', () => {
        const dockerfile = readFileSync('Dockerfile', 'utf8');
        expect(dockerfile).toContain('/app/src/lib ./src/lib');
        expect(dockerfile).toContain('/app/scripts/commerce-media-worker.ts');
        expect(dockerfile).toContain('/app/scripts/weekend-stabilize.ts');
        expect(dockerfile).toContain('/app/scripts/stage-grant-rollback-preflight.ts');
    });

    it('exposes an import-only worker smoke without opening external services', () => {
        const worker = readFileSync('scripts/commerce-media-worker.ts', 'utf8');
        expect(worker).toContain("BEACON_WORKER_IMPORT_SMOKE === '1'");
        expect(worker).toContain('runtime imports loaded');
    });
});
