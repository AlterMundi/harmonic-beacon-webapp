#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';

import { classifyMigrationState, type MigrationRecord } from '../src/lib/release-migration-state';
import { redactError } from '../src/lib/redact';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const candidateMigrations = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrationSql = new Map(await Promise.all(candidateMigrations.map(async (name) => [
    name,
    await readFile(`prisma/migrations/${name}/migration.sql`),
  ] as const)));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const rows = await prisma.$queryRaw<Array<{
      migration_name: string;
      checksum: string | null;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name, started_at`;
    const records: MigrationRecord[] = rows.map((row) => ({
      migrationName: row.migration_name,
      checksum: row.checksum,
      finishedAt: row.finished_at,
      rolledBackAt: row.rolled_back_at,
    }));
    const state = classifyMigrationState(candidateMigrations, records, migrationSql);
    console.log(JSON.stringify(state));
    if (!state.databaseStateVerified) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(redactError(error));
  process.exitCode = 1;
});
