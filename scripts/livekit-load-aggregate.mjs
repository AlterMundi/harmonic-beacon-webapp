#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateShardManifests } from './lib/livekit-load-harness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
    process.stdout.write(
        'Usage: node scripts/livekit-load-aggregate.mjs --output PATH SHARD_MANIFEST...\n',
    );
}

function parseArguments() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) return { help: true };
    const outputIndex = args.indexOf('--output');
    if (outputIndex < 0 || !args[outputIndex + 1]) {
        throw new Error('--output is required');
    }
    const output = resolve(repositoryRoot, args[outputIndex + 1]);
    const manifests = args.filter((_, index) => index !== outputIndex && index !== outputIndex + 1);
    if (manifests.some((argument) => argument.startsWith('-'))) {
        throw new Error('unknown option');
    }
    if (manifests.length < 2) throw new Error('at least two shard manifests are required');
    return {
        help: false,
        output,
        manifests: manifests.map((path) => resolve(repositoryRoot, path)),
    };
}

async function main() {
    const options = parseArguments();
    if (options.help) {
        printHelp();
        return;
    }
    try {
        await access(options.output, constants.F_OK);
        throw new Error('refusing to overwrite an existing aggregate');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const entries = await Promise.all(options.manifests.map(async (path) => {
        const bytes = await readFile(path);
        return {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            manifest: JSON.parse(bytes.toString('utf8')),
        };
    }));
    const aggregate = aggregateShardManifests(entries);
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(aggregate, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
    });
    process.stdout.write(`Aggregate: ${options.output}\nStatus: ${aggregate.status}\n`);
}

main().catch((error) => {
    process.stderr.write(
        `load aggregate refused or failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
});
