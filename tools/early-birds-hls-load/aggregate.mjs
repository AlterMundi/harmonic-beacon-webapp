#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { aggregateEvidence } from './src/contracts.mjs';

function printHelp() {
  process.stdout.write(
    'Usage: node tools/early-birds-hls-load/aggregate.mjs --output PATH SHARD_EVIDENCE...\n',
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return printHelp();
  const outputIndex = args.indexOf('--output');
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--output is required');
  const output = resolve(args[outputIndex + 1]);
  const sources = args.filter((_, index) => index !== outputIndex && index !== outputIndex + 1);
  if (sources.length === 0 || sources.some((value) => value.startsWith('--'))) {
    throw new Error('one exact shard evidence path per shard is required');
  }
  try {
    await access(output, constants.F_OK);
    throw new Error('refusing to overwrite an existing aggregate evidence file');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const entries = await Promise.all(sources.map(async (source) => {
    const bytes = await readFile(resolve(source));
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      evidence: JSON.parse(bytes.toString('utf8')),
    };
  }));
  const aggregate = aggregateEvidence(entries);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(aggregate, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`Aggregate evidence: ${output}\nStatus: ${aggregate.status}\n`);
  if (aggregate.status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `EarlyBird HLS evidence aggregation refused: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
