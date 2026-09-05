import { readFileSync } from 'node:fs';
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
];

describe('stage grant writer contract', () => {
    it.each(GRANT_WRITERS)('%s uses the durable transition primitive', (path) => {
        const source = read(path);

        expect(source).toContain('transitionParticipantGrant');
        expect(source).not.toMatch(/grantReconcileNeeded\s*:\s*false/);
        expect(source).not.toMatch(/grantVersion\s*:\s*\{\s*increment/);
    });

    it('drains versioned grant effects before legacy commerce removals', () => {
        const worker = read('scripts/commerce-media-worker.ts');
        const grant = worker.indexOf('await processNextStageGrantEffect()');
        const legacy = worker.indexOf('await processNextCommerceMediaJob()');

        expect(grant).toBeGreaterThan(-1);
        expect(legacy).toBeGreaterThan(grant);
    });
});
