import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  classifyMigrationState,
  isolatedRestoreDatabaseUrl,
  migrationChecksum,
  validateForwardOnlyMigration,
} from '../release-migration-state';

const firstSql = 'CREATE TABLE "first" ("id" UUID PRIMARY KEY);\n';
const secondSql = 'ALTER TABLE "first" ADD COLUMN "label" TEXT;\n';
const checksum = (sql: string) => createHash('sha256').update(Buffer.from(sql)).digest('hex');

describe('release migration state', () => {
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
        { migrationName: name, checksum: '0'.repeat(64), finishedAt: null, rolledBackAt: new Date() },
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
