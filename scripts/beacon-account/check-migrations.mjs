#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

const mode = process.argv[2];
if (!['before', 'after'].includes(mode)) throw new Error('usage: check-migrations.mjs before|after');
const expected = (process.env.BEACON_ACCOUNT_EXPECTED_PENDING_MIGRATIONS ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean).sort();
if (expected.length === 0) throw new Error('expected pending Account migration list is empty');
const target = process.env.BEACON_ACCOUNT_SCHEMA_VERSION?.trim();
if (!target || expected.at(-1) !== target) throw new Error('target schema must equal final expected migration');

const migrationRoot = path.resolve(process.cwd(), 'prisma/migrations');
const available = (await fs.readdir(migrationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name))
  .map((entry) => entry.name).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(
    'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name',
  );
  const unresolved = result.rows.filter((row) => row.finished_at === null && row.rolled_back_at === null);
  if (unresolved.length) throw new Error('database contains an unresolved migration');
  const applied = new Set(result.rows
    .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .map((row) => row.migration_name));
  const pending = available.filter((name) => !applied.has(name));
  if (mode === 'before') {
    const exactPending = JSON.stringify(pending) === JSON.stringify(expected);
    const exactAlreadyApplied = pending.length === 0 && applied.has(target);
    if (!exactPending && !exactAlreadyApplied) {
      throw new Error('pending migrations differ from the reviewed Account-only list');
    }
  }
  if (mode === 'after' && pending.length !== 0) throw new Error('migrations remain pending after deploy');
} finally {
  await client.end();
}
