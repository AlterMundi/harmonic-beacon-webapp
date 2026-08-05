import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
    resolve(process.cwd(), '.github/workflows/livekit-capacity.yml'),
    'utf8',
);

describe('distributed LiveKit capacity workflow contract', () => {
    it('is manual, least-privilege and cannot receive an arbitrary target input', () => {
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).not.toMatch(/^\s+pull_request:/m);
        expect(workflow).not.toMatch(/^\s+push:/m);
        expect(workflow).toContain('contents: read');
        expect(workflow).not.toContain('target_url:');
        expect(workflow).toContain('secrets.LOAD_TEST_URL');
        expect(workflow).not.toContain('secrets.LIVEKIT_API_SECRET');
        expect(workflow).not.toMatch(/--(?:profile|run-id|start-at) '\$\{\{/);
        expect(workflow).toContain('--run-id "$LOAD_RUN_ID"');
    });

    it('uses two independent hosted runners and always preserves shard evidence', () => {
        expect(workflow).toContain('shard_index: [0, 1]');
        expect(workflow).toContain('fail-fast: false');
        expect(workflow.match(/environment: capacity-rehearsal/g)).toHaveLength(2);
        expect(workflow).toContain('if: always()');
        expect(workflow).toContain('livekit-load-aggregate.mjs');
        expect(workflow).toContain('ref: ${{ github.sha }}');
    });

    it('pins and verifies the official LiveKit CLI artifact', () => {
        expect(workflow).toContain('releases/download/v2.16.3/');
        expect(workflow).toContain(
            '57935ce348a634a1e12769b9eaf7e684cf46920ad65e4b6d88f87a9cd01de2d6',
        );
        expect(workflow).toContain('sha256sum -c -');
    });
});
