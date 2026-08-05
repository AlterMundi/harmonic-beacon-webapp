import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildDistributedDispatchPlan } from '../../../scripts/lib/livekit-load-harness.mjs';

const workflow = readFileSync(
    resolve(process.cwd(), '.github/workflows/livekit-capacity.yml'),
    'utf8',
);
const profiles = JSON.parse(readFileSync(
    resolve(process.cwd(), 'config/livekit-load-profiles.json'),
    'utf8',
)).profiles;

describe('distributed LiveKit capacity workflow contract', () => {
    it('is manual, least-privilege and cannot receive an arbitrary target input', () => {
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).not.toMatch(/^\s+pull_request:/m);
        expect(workflow).not.toMatch(/^\s+push:/m);
        expect(workflow).toContain('contents: read');
        expect(workflow).not.toContain('target_url:');
        expect(workflow).not.toContain('readiness_url:');
        expect(workflow).toContain('secrets.LOAD_TEST_URL');
        expect(workflow).not.toContain('secrets.LIVEKIT_API_SECRET');
        expect(workflow).not.toMatch(/--(?:profile|run-id|start-at) '\$\{\{/);
        expect(workflow).toContain('--run-id "$LOAD_RUN_ID"');
        expect(workflow.match(/--guard-production-ready/g)).toHaveLength(1);
    });

    it('uses a bounded dynamic hosted-runner matrix and always preserves shard evidence', () => {
        expect(workflow).toContain("default: '2'");
        expect(workflow).toContain("- '6'");
        expect(workflow).toContain('fromJSON(needs.prepare.outputs.shard_indices)');
        expect(workflow).toContain('--shard-count "$LOAD_SHARD_COUNT"');
        expect(workflow).toContain('shard_paths+=("$shard_path")');
        expect(workflow).toContain('fail-fast: false');
        expect(workflow.match(/environment: capacity-rehearsal/g)).toHaveLength(2);
        expect(workflow).toContain('if: always()');
        expect(workflow).toContain('livekit-load-aggregate.mjs');
        expect(workflow).toContain('ref: ${{ github.sha }}');
    });

    it('budgets the longest dispatch plan plus bounded runner overhead', () => {
        const timeoutMinutes = Number(workflow.match(/timeout-minutes:\s*(\d+)/)?.[1]);
        const startDelayChoices = [...workflow.matchAll(/^\s+- '(\d+)'$/gm)]
            .map((match) => Number(match[1]));
        const maxStartDelaySeconds = Math.max(...startDelayChoices);
        const nowMs = Date.parse('2026-08-05T00:00:00.000Z');
        const setupAndEvidenceMarginSeconds = 300;

        for (const [profileName, profile] of Object.entries(profiles)) {
            const plan = buildDistributedDispatchPlan({
                profileName,
                profile,
                runId: `timeout-${profileName}`,
                targetUrl: 'ws://example.test:7890',
                startDelaySeconds: maxStartDelaySeconds,
                nowMs,
            });
            const requiredSeconds =
                (Date.parse(plan.expectedEndAt) - nowMs) / 1000 +
                setupAndEvidenceMarginSeconds;
            expect(timeoutMinutes * 60, profileName).toBeGreaterThanOrEqual(requiredSeconds);
        }
    });

    it('pins and verifies the official LiveKit CLI artifact', () => {
        expect(workflow).toContain('releases/download/v2.16.3/');
        expect(workflow).toContain(
            '57935ce348a634a1e12769b9eaf7e684cf46920ad65e4b6d88f87a9cd01de2d6',
        );
        expect(workflow).toContain('sha256sum -c -');
    });
});
