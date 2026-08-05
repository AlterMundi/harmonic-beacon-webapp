import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    assertLiveKitCliMeasurementCompatibility,
    buildDistributedDispatchPlan,
} from '../../../scripts/lib/livekit-load-harness.mjs';

const workflow = readFileSync(
    resolve(process.cwd(), '.github/workflows/livekit-capacity.yml'),
    'utf8',
);
const e2eWorkflow = readFileSync(
    resolve(process.cwd(), '.github/workflows/e2e.yml'),
    'utf8',
);
const installer = readFileSync(
    resolve(process.cwd(), 'scripts/install-livekit-load-cli.sh'),
    'utf8',
);
const livekitPatch = readFileSync(
    resolve(process.cwd(), 'scripts/patches/livekit-cli-v2.16.3-vp8-depacketizer.patch'),
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
        const shardCountOptions = workflow.match(
            /shard_count:[\s\S]*?options:\n((?:\s+- '\d+'\n)+)/,
        )?.[1] ?? '';
        const shardCountChoices = [...shardCountOptions.matchAll(/- '(\d+)'/g)]
            .map((match) => Number(match[1]));
        const maxStartDelaySeconds = Math.max(...startDelayChoices);
        const nowMs = Date.parse('2026-08-05T00:00:00.000Z');
        const setupAndEvidenceMarginSeconds = 300;

        expect(shardCountChoices).toEqual([2, 6]);
        for (const [profileName, profile] of Object.entries(profiles)) {
            const { attendees, rampPerSecond } = profile as {
                attendees: number;
                rampPerSecond: number;
            };
            for (const shardCount of shardCountChoices) {
                if (shardCount > attendees || shardCount > rampPerSecond) continue;
                const plan = buildDistributedDispatchPlan({
                    profileName,
                    profile,
                    runId: `timeout-${profileName}-${shardCount}`,
                    targetUrl: 'ws://example.test:7890',
                    startDelaySeconds: maxStartDelaySeconds,
                    shardCount,
                    nowMs,
                });
                const requiredSeconds =
                    (Date.parse(plan.expectedEndAt) - nowMs) / 1000 +
                    setupAndEvidenceMarginSeconds;
                expect(
                    timeoutMinutes * 60,
                    `${profileName}/${shardCount} shards`,
                ).toBeGreaterThanOrEqual(requiredSeconds);
            }
        }
    });

    it('builds one provenance-marked VP8 tester and shares it with every shard', () => {
        expect(installer).toContain('e90c82ab4467cafd4fabe3affd348f474c312280');
        expect(installer).toContain('git -C "$SOURCE_ROOT" lfs fsck');
        expect(installer).toContain('git -C "$SOURCE_ROOT" apply --check "$PATCH_FILE"');
        expect(livekitPatch).toContain('dpkt = &codecs.VP8Packet{}');
        expect(livekitPatch).toContain('Version = "2.16.3-hb-vp8.1"');
        expect(workflow.match(/install-livekit-load-cli\.sh/g)).toHaveLength(1);
        expect(workflow).toContain('actions/upload-artifact@v4');
        expect(workflow).toContain('actions/download-artifact@v4');
        expect(workflow).toContain('livekit-load-cli-${{ github.run_id }}');
        expect(e2eWorkflow).toContain('install-livekit-load-cli.sh "$RUNNER_TEMP/lk"');
        expect(workflow).not.toContain('releases/download/v2.16.3/');
        expect(assertLiveKitCliMeasurementCompatibility({
            stageVideoCodec: 'vp8',
            livekitCliVersion: 'lk version 2.16.3-hb-vp8.1',
        })).toMatchObject({ verified: true });
    });

    it('offers a bounded full-topology VP8 diagnostic without weakening rehearsal profiles', () => {
        expect(workflow).toContain('- diagnostic-en-vp8');
        expect(profiles['diagnostic-en-vp8']).toMatchObject({
            attendees: 150,
            stagePublishers: 6,
            beaconPublishers: 1,
            stageVideoCodec: 'vp8',
            stageLayout: 'speaker',
            rampDurationSeconds: 60,
            soakDurationSeconds: 60,
            reconnectWaves: 0,
            maxDroppedPercent: 0.1,
        });
        expect(profiles['rehearsal-en']).toMatchObject({
            soakDurationSeconds: 1200,
            reconnectWaves: 2,
            maxDroppedPercent: 0.1,
        });

        const plan = buildDistributedDispatchPlan({
            profileName: 'diagnostic-en-vp8',
            profile: profiles['diagnostic-en-vp8'],
            runId: 'server-version-control',
            targetUrl: 'ws://example.test:7890',
            startDelaySeconds: 900,
            shardCount: 6,
            nowMs: Date.parse('2026-08-05T00:00:00.000Z'),
        });
        expect(plan.shardCount).toBe(6);
        expect(plan.expectedEndAt).toBe('2026-08-05T00:19:05.000Z');
    });
});
