#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDistributedDispatchPlan } from './lib/livekit-load-harness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
    return process.argv[index + 1];
}

async function main() {
    const profilesDocument = JSON.parse(await readFile(
        resolve(repositoryRoot, 'config/livekit-load-profiles.json'),
        'utf8',
    ));
    const profileName = option('--profile');
    const profile = profilesDocument.profiles?.[profileName];
    if (!profile) throw new Error(`unknown profile: ${profileName}`);
    const targetUrl = process.env.LOAD_TEST_URL;
    if (!targetUrl) throw new Error('LOAD_TEST_URL is required');
    const plan = buildDistributedDispatchPlan({
        profileName,
        profile,
        runId: option('--run-id'),
        targetUrl,
        startDelaySeconds: Number(option('--start-delay-seconds')),
        shardCount: Number(option('--shard-count')),
    });
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) throw new Error('GITHUB_OUTPUT is required');
    const outputs = {
        run_id: plan.runId,
        start_at: plan.startAt,
        expected_end_at: plan.expectedEndAt,
        confirmation: plan.confirmation,
        shard_count: String(plan.shardCount),
        shard_indices: JSON.stringify(Array.from(
            { length: plan.shardCount },
            (_, shardIndex) => shardIndex,
        )),
    };
    await appendFile(
        outputPath,
        Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''),
        { mode: 0o600 },
    );
    process.stdout.write(
        `Validated ${plan.profileName} run ${plan.runId}: ` +
        `${plan.shardCount} shards, ${plan.startAt} to ${plan.expectedEndAt}, ` +
        `target host ${plan.targetHost}.\n`,
    );
}

main().catch((error) => {
    process.stderr.write(
        `distributed load plan refused: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
});
