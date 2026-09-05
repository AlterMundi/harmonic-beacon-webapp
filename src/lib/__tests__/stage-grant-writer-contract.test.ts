import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const GRANT_WRITERS = [
    'src/lib/stage-control.ts',
    'src/lib/commerce-entitlement.ts',
    'src/app/api/ops/admission/[id]/route.ts',
    'src/app/api/ops/invitations/[id]/route.ts',
    'scripts/weekend-stabilize.ts',
    'prisma/seed.ts',
    'prisma/seed-test-fixtures.ts',
];

function runtimeSources(directory: string): string[] {
    return readdirSync(join(ROOT, directory), { withFileTypes: true })
        .flatMap((entry) => {
            const relative = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === '__tests__' || entry.name === 'migrations') return [];
                return runtimeSources(relative);
            }
            return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
        });
}

describe('stage grant writer contract', () => {
    it.each(GRANT_WRITERS)('%s uses the durable transition primitive', (path) => {
        const source = read(path);

        expect(source).toContain('transitionParticipantGrant');
        expect(source).not.toMatch(/grantReconcileNeeded\s*:\s*false/);
        expect(source).not.toMatch(/grantVersion\s*:\s*\{\s*increment/);
    });

    it('rejects direct marker clearing or revision increments repository-wide', () => {
        const bypasses = ['src', 'scripts', 'prisma']
            .flatMap(runtimeSources)
            .filter((path) => path !== 'src/lib/stage-grant-effects.ts')
            .flatMap((path) => {
                const source = read(path);
                return /grantReconcileNeeded\s*:\s*false/.test(source) ||
                    /grantVersion\s*:\s*\{\s*increment/.test(source)
                    ? [path]
                    : [];
            });

        expect(bypasses).toEqual([]);
    });

    it('drains versioned grant effects before legacy commerce removals', () => {
        const worker = read('scripts/commerce-media-worker.ts');
        const grant = worker.indexOf('await processNextStageGrantEffect()');
        const legacy = worker.indexOf('await processNextCommerceMediaJob()');

        expect(grant).toBeGreaterThan(-1);
        expect(legacy).toBeGreaterThan(grant);
    });
});
