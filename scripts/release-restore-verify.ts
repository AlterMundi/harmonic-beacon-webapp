#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';

import { isolatedRestoreDatabaseUrl } from '../src/lib/release-migration-state';

function run(command: string, args: string[], env: NodeJS.ProcessEnv, capture = false): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'ignore', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return capture ? result.stdout.trim() : '';
}

function main(): void {
  const baseUrl = process.env.DATABASE_URL?.trim();
  const restoreDatabase = process.env.HB_RESTORE_DATABASE_NAME?.trim();
  if (!baseUrl) throw new Error('DATABASE_URL is required');
  if (!restoreDatabase) throw new Error('HB_RESTORE_DATABASE_NAME is required');
  const env = {
    ...process.env,
    DATABASE_URL: isolatedRestoreDatabaseUrl(baseUrl, restoreDatabase),
  };

  run('npx', ['prisma', 'migrate', 'deploy'], env);
  const state = JSON.parse(run('npx', ['tsx', 'scripts/release-migration-state.ts'], env, true)) as {
    databaseStateVerified?: boolean;
    pending?: unknown[];
    failed?: unknown[];
    unexpected?: unknown[];
    unsafe?: unknown[];
  };
  if (state.databaseStateVerified !== true || state.pending?.length !== 0 || state.failed?.length !== 0 ||
      state.unexpected?.length !== 0 || state.unsafe?.length !== 0) {
    throw new Error('candidate migration did not verify on the isolated restored database');
  }
  console.log(JSON.stringify({ candidateMigrationVerified: true }));
}

try {
  main();
} catch {
  console.error('Isolated restore candidate migration verification failed');
  process.exitCode = 1;
}
