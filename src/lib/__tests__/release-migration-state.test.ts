import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  classifyMigrationState,
  isolatedRestoreDatabaseUrl,
  migrationChecksum,
  type MigrationRecord,
  validateForwardOnlyMigration,
} from '../release-migration-state';

const firstSql = 'CREATE TABLE "first" ("id" UUID PRIMARY KEY);\n';
const secondSql = 'ALTER TABLE "first" ADD COLUMN "label" TEXT;\n';
const checksum = (sql: string) => createHash('sha256').update(Buffer.from(sql)).digest('hex');

describe('release migration state', () => {
  it('admits only the exact named September event seed, never arbitrary procedural SQL', () => {
    const name = '20260923120000_create_sep23_proyecciones_mito';
    const sql = readFileSync(new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
    expect(classifyMigrationState([name], [], new Map([[name, sql]])).unsafe).toEqual([]);
    expect(classifyMigrationState([name], [], new Map([[name, sql + '\n']])).unsafe.length).toBeGreaterThan(0);
    expect(classifyMigrationState(['other'], [], new Map([['other', sql]])).unsafe.length).toBeGreaterThan(0);
    expect(validateForwardOnlyMigration(sql).safe).toBe(false);
    expect(sql).toContain('"scene_capacity" = 6');
  });
  it('reports exact pending migrations only when applied Prisma checksums match committed raw bytes', () => {
    expect(classifyMigrationState(
      ['20260909000000_first', '20260910000000_second'],
      [{
        migrationName: '20260909000000_first',
        checksum: checksum(firstSql),
        finishedAt: new Date(),
        rolledBackAt: null,
      }],
      new Map([
        ['20260909000000_first', firstSql],
        ['20260910000000_second', secondSql],
      ]),
    )).toEqual({
      schemaVersion: 'harmonic-beacon.migration-state.v1',
      databaseStateVerified: true,
      applied: ['20260909000000_first'],
      pending: ['20260910000000_second'],
      failed: [],
      unexpected: [],
      unsafe: [],
      checksumErrors: [],
      duplicateRecords: [],
      conflictingRecords: [],
      historicalChecksumMatches: [],
      migrationChecksums: [
        { migrationName: '20260909000000_first', checksum: checksum(firstSql) },
        { migrationName: '20260910000000_second', checksum: checksum(secondSql) },
      ],
    });
  });

  it('uses Prisma raw migration.sql SHA-256 representation including exact line endings', () => {
    const raw = Buffer.from('CREATE TABLE "raw" ("id" INT);\r\n');
    expect(migrationChecksum(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(migrationChecksum(raw)).not.toBe(migrationChecksum(Buffer.from(raw.toString('utf8').replaceAll('\r\n', '\n'))));
  });

  it('accepts the exact configurable scene-capacity migration bytes as forward-only', () => {
    const migration = readFileSync(new URL(
      '../../../prisma/migrations/20260916010000_configurable_scene_capacity/migration.sql',
      import.meta.url,
    ));

    expect(validateForwardOnlyMigration(migration)).toEqual({ safe: true, violations: [] });
  });

  it('accepts the committed Account identity snapshot migration through the deployment gate', () => {
    const migration = readFileSync(new URL(
      '../../../prisma/migrations/20260921171000_live_account_profile_snapshot/migration.sql',
      import.meta.url,
    ));
    expect(validateForwardOnlyMigration(migration)).toEqual({ safe: true, violations: [] });
  });

  it('accepts only the exact future-row scene-capacity default migration', () => {
    const migration = readFileSync(new URL(
      '../../../prisma/migrations/20260917211500_default_scene_capacity_12/migration.sql',
      import.meta.url,
    ));

    expect(validateForwardOnlyMigration(migration)).toEqual({ safe: true, violations: [] });
  });

  it.each([
    'ALTER TABLE "other_sessions" ALTER COLUMN "scene_capacity" SET DEFAULT 12;',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "other_capacity" SET DEFAULT 12;',
    'ALTER TABLE "SCHEDULED_SESSIONS" ALTER COLUMN "scene_capacity" SET DEFAULT 12;',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "SCENE_CAPACITY" SET DEFAULT 12;',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "scene_capacity" SET DEFAULT 6;',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "scene_capacity" SET DEFAULT 12 + 0;',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "scene_capacity" SET DEFAULT 12, DROP COLUMN "title";',
    'ALTER TABLE "scheduled_sessions" ALTER COLUMN "scene_capacity" SET DEFAULT 12; UPDATE "scheduled_sessions" SET "scene_capacity" = 12;',
  ])('rejects adjacent mutations outside the default-12 migration boundary: %s', (sql) => {
    expect(validateForwardOnlyMigration(sql)).toEqual(expect.objectContaining({
      safe: false,
    }));
  });

  it('fails closed on missing, mismatched, duplicate, and conflicting applied records', () => {
    const name = '20260909000000_first';
    const exact = checksum(firstSql);
    const cases = [
      [{ migrationName: name, checksum: null, finishedAt: new Date(), rolledBackAt: null }],
      [{ migrationName: name, checksum: '0'.repeat(64), finishedAt: new Date(), rolledBackAt: null }],
      [
        { migrationName: name, checksum: exact, finishedAt: new Date(), rolledBackAt: null },
        { migrationName: name, checksum: exact, finishedAt: new Date(), rolledBackAt: null },
      ],
      [
        { migrationName: name, checksum: exact, finishedAt: new Date(), rolledBackAt: null },
        { migrationName: name, checksum: '0'.repeat(64), finishedAt: null, rolledBackAt: null },
      ],
    ];
    for (const records of cases) {
      expect(classifyMigrationState([name], records, new Map([[name, firstSql]]))).toEqual(expect.objectContaining({
        databaseStateVerified: false,
      }));
    }
    expect(classifyMigrationState([name], cases[0], new Map([[name, firstSql]])).checksumErrors).toEqual([`${name}:MISSING CHECKSUM`]);
    expect(classifyMigrationState([name], cases[1], new Map([[name, firstSql]])).checksumErrors).toEqual([`${name}:CHECKSUM MISMATCH`]);
    expect(classifyMigrationState([name], cases[2], new Map([[name, firstSql]])).duplicateRecords).toEqual([name]);
    expect(classifyMigrationState([name], cases[3], new Map([[name, firstSql]])).conflictingRecords).toEqual([name]);
  });

  it('fails closed on unfinished and unexpected database migrations', () => {
    expect(classifyMigrationState(
      ['20260909000000_first'],
      [
        { migrationName: '20260909000000_first', checksum: checksum(firstSql), finishedAt: null, rolledBackAt: null },
        { migrationName: '20260808000000_unknown', checksum: 'a'.repeat(64), finishedAt: new Date(), rolledBackAt: null },
      ],
      new Map([['20260909000000_first', firstSql]]),
    )).toEqual(expect.objectContaining({
      databaseStateVerified: false,
      failed: ['20260909000000_first'],
      unexpected: ['20260808000000_unknown'],
    }));
  });

  it('keeps a single explicitly rolled-back attempt pending when its record is otherwise coherent', () => {
    expect(classifyMigrationState(
      ['20260909000000_first'],
      [{ migrationName: '20260909000000_first', checksum: checksum(firstSql), finishedAt: null, rolledBackAt: new Date() }],
      new Map([['20260909000000_first', firstSql]]),
    )).toEqual(expect.objectContaining({
      databaseStateVerified: true,
      applied: [],
      pending: ['20260909000000_first'],
      failed: [],
    }));
  });

  it('accepts the four observed production rows with two exact historical aliases and one resolved retry', () => {
    const weekend = '20260728120000_weekend_mvp';
    const cycle = '20260818030000_four_saturday_public_cycle';
    const ensure = '20260818163000_ensure_four_saturday_public_cycle';
    const sql = new Map([
      [weekend, readFileSync(new URL('../../../prisma/migrations/20260728120000_weekend_mvp/migration.sql', import.meta.url))],
      [cycle, readFileSync(new URL('../../../prisma/migrations/20260818030000_four_saturday_public_cycle/migration.sql', import.meta.url))],
      [ensure, readFileSync(new URL('../../../prisma/migrations/20260818163000_ensure_four_saturday_public_cycle/migration.sql', import.meta.url))],
    ]);
    const state = classifyMigrationState([weekend, cycle, ensure], [
      { migrationName: weekend, checksum: '0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b', finishedAt: new Date('2026-08-01T01:46:52.995Z'), rolledBackAt: null },
      { migrationName: cycle, checksum: 'eb2984af3f82406a8e33752d6fbcf6f2afe32e31d1e97a5f6fb2b12467970eb0', finishedAt: new Date('2026-08-18T18:14:07.4988Z'), rolledBackAt: null },
      { migrationName: ensure, checksum: '75c86e6d49805f5e000185532cbd795ab1e7f9b0221eedd727bc88df0fcbf7b9', finishedAt: null, rolledBackAt: new Date('2026-08-20T05:29:39.181506Z') },
      { migrationName: ensure, checksum: '75c86e6d49805f5e000185532cbd795ab1e7f9b0221eedd727bc88df0fcbf7b9', finishedAt: new Date('2026-08-20T05:34:05.823045Z'), rolledBackAt: null },
    ], sql);
    expect(state).toEqual(expect.objectContaining({
      databaseStateVerified: true,
      applied: [weekend, cycle, ensure], pending: [], failed: [],
      duplicateRecords: [], conflictingRecords: [], checksumErrors: [],
    }));
    expect(state.historicalChecksumMatches).toEqual([
      { migrationName: weekend, checksum: '0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b', currentChecksum: 'e654db87b9d8b0fa996a89a83938ff53260abf1b278e84d43f949a1fde040ab4', historicalSourceCommit: '29b0f567e0e280f4b57674be6d6d56a352716832' },
      { migrationName: cycle, checksum: 'eb2984af3f82406a8e33752d6fbcf6f2afe32e31d1e97a5f6fb2b12467970eb0', currentChecksum: '3418053a797b9d71bbee7a52a76d479694ad6d64e86232f35b464462bf00f9fa', historicalSourceCommit: '82f0b246d416a8c01846465b55b9f6cf340f2b9e' },
    ]);
  });

  it('rejects active duplicates, impossible records, unresolved failures and unproven historical hashes', () => {
    const weekend = '20260728120000_weekend_mvp';
    const current = readFileSync(new URL('../../../prisma/migrations/20260728120000_weekend_mvp/migration.sql', import.meta.url));
    const exact = migrationChecksum(current);
    const classify = (records: MigrationRecord[], sql: string | Buffer = current, name = weekend) =>
      classifyMigrationState([name], records.map((record) => ({...record,migrationName:name})), new Map([[name,sql]]));
    expect(classify([
      {migrationName:weekend,checksum:exact,finishedAt:new Date(),rolledBackAt:null},
      {migrationName:weekend,checksum:exact,finishedAt:new Date(),rolledBackAt:null},
    ]).duplicateRecords).toEqual([weekend]);
    expect(classify([{migrationName:weekend,checksum:exact,finishedAt:new Date(),rolledBackAt:new Date()}]).conflictingRecords).toEqual([weekend]);
    expect(classify([{migrationName:weekend,checksum:exact,finishedAt:null,rolledBackAt:null}]).failed).toEqual([weekend]);
    expect(classify([{migrationName:weekend,checksum:'not-a-sha',finishedAt:null,rolledBackAt:new Date()}]).checksumErrors).toEqual([`${weekend}:CHECKSUM MISMATCH`]);
    expect(classify([{migrationName:weekend,checksum:'f'.repeat(64),finishedAt:null,rolledBackAt:new Date()}]).checksumErrors).toEqual([`${weekend}:CHECKSUM MISMATCH`]);
    expect(classify([{migrationName:weekend,checksum:'0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b',finishedAt:new Date(),rolledBackAt:null}], Buffer.concat([current,Buffer.from('\n')])).checksumErrors).toEqual([`${weekend}:CHECKSUM MISMATCH`]);
    const wrong = '20260909000000_first';
    expect(classify([{migrationName:wrong,checksum:'0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b',finishedAt:new Date(),rolledBackAt:null}], current, wrong).checksumErrors).toEqual([`${wrong}:CHECKSUM MISMATCH`]);
  });

  it.each([
    ['DROP INDEX "unique_payment_id";', 'DROP'],
    ['ALTER TABLE "users" DROP CONSTRAINT "users_email_key";', 'DROP'],
    ['DROP TYPE "LegacyRole";', 'DROP'],
    ['DROP VIEW "legacy_users";', 'DROP'],
    ['DROP SCHEMA "legacy";', 'DROP'],
    ['ALTER TABLE "users" ALTER COLUMN "email" TYPE TEXT;', 'ALTER TABLE'],
    ['ALTER TABLE "users" RENAME COLUMN "email" TO "address";', 'ALTER TABLE'],
    ['ALTER TABLE "users" ADD COLUMN "safe" TEXT, ALTER COLUMN "email" TYPE INTEGER;', 'ALTER TABLE'],
    ['ALTER TABLE "users" ADD COLUMN "safe" TEXT, RENAME COLUMN "email" TO "address";', 'ALTER TABLE'],
    ['ALTER TABLE "users" ADD COLUMN "safe" TEXT, SET UNLOGGED;', 'ALTER TABLE'],
    ['TRUNCATE TABLE "users";', 'TRUNCATE'],
    ['DELETE FROM "users";', 'DELETE'],
    ['-- hide a drop\nCREATE TABLE "safe" ("id" INT);', 'COMMENT'],
    ['CREATE TABLE "safe" ("id" INT); /* hidden */', 'COMMENT'],
    ['DO $$ BEGIN EXECUTE \'DROP TABLE users\'; END $$;', 'DYNAMIC SQL'],
    ['CREATE TABLE "unterminated ("id" INT);', 'AMBIGUOUS SQL'],
  ])('rejects destructive or ambiguous SQL: %s', (sql, violation) => {
    expect(validateForwardOnlyMigration(sql)).toEqual(expect.objectContaining({
      safe: false,
      violations: expect.arrayContaining([violation]),
    }));
  });

  it.each([
    'CREATE TYPE "StaffRole" AS ENUM (\'ADMIN\', \'OPERATOR\');',
    'CREATE TABLE "audit_log" ("id" UUID PRIMARY KEY, "created_at" TIMESTAMPTZ NOT NULL);',
    'CREATE UNIQUE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");',
    'ALTER TABLE "audit_log" ADD COLUMN "label" TEXT;',
    'ALTER TABLE "audit_log" ADD CONSTRAINT "audit_label_key" UNIQUE ("label");',
    'ALTER TYPE "StaffRole" ADD VALUE \'FACILITATOR\';',
    'INSERT INTO "audit_log" ("id") VALUES (\'00000000-0000-0000-0000-000000000001\');',
    'INSERT INTO "audit_log" ("id") VALUES (\'00000000-0000-0000-0000-000000000001\') ON CONFLICT ("id") DO NOTHING;',
  ])('accepts a legitimate forward addition: %s', (sql) => {
    expect(validateForwardOnlyMigration(sql)).toEqual({ safe: true, violations: [] });
  });

  it('marks a pending non-allowlisted migration unsafe', () => {
    expect(classifyMigrationState(
      ['20260910000000_destructive'],
      [],
      new Map([['20260910000000_destructive', 'DROP INDEX "unique_payment_id";']]),
    )).toEqual(expect.objectContaining({
      databaseStateVerified: false,
      pending: ['20260910000000_destructive'],
      unsafe: ['20260910000000_destructive:DROP'],
    }));
  });

  it('derives only a bounded isolated restore database URL', () => {
    expect(isolatedRestoreDatabaseUrl(
      'postgresql://beacon:***@postgres:5432/beacon?schema=public',
      'hb_restore_42',
    )).toBe('postgresql://beacon:***@postgres:5432/hb_restore_42?schema=public');
    expect(() => isolatedRestoreDatabaseUrl('postgresql://postgres/beacon', 'beacon')).toThrow(/restore database name/);
    expect(() => isolatedRestoreDatabaseUrl('postgresql://postgres/beacon', '../beacon')).toThrow(/restore database name/);
  });
});
