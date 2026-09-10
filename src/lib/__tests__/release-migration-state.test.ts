import { describe, expect, it } from 'vitest';

import { classifyMigrationState, isolatedRestoreDatabaseUrl } from '../release-migration-state';

describe('release migration state', () => {
  it('reports exact pending migrations from verified database records', () => {
    expect(classifyMigrationState(
      ['20260909000000_first', '20260910000000_second'],
      [{ migrationName: '20260909000000_first', finishedAt: new Date(), rolledBackAt: null }],
    )).toEqual({
      schemaVersion: 'harmonic-beacon.migration-state.v1',
      databaseStateVerified: true,
      applied: ['20260909000000_first'],
      pending: ['20260910000000_second'],
      failed: [],
      unexpected: [],
      unsafe: [],
    });
  });

  it('fails closed on unfinished and unexpected database migrations', () => {
    expect(classifyMigrationState(
      ['20260909000000_first'],
      [
        { migrationName: '20260909000000_first', finishedAt: null, rolledBackAt: null },
        { migrationName: '20260808000000_unknown', finishedAt: new Date(), rolledBackAt: null },
      ],
    )).toEqual(expect.objectContaining({
      databaseStateVerified: false,
      failed: ['20260909000000_first'],
      unexpected: ['20260808000000_unknown'],
    }));
  });

  it('ignores explicitly rolled-back attempts but still leaves their migration pending', () => {
    expect(classifyMigrationState(
      ['20260909000000_first'],
      [{ migrationName: '20260909000000_first', finishedAt: null, rolledBackAt: new Date() }],
    )).toEqual(expect.objectContaining({
      databaseStateVerified: true,
      applied: [],
      pending: ['20260909000000_first'],
      failed: [],
    }));
  });

  it('rejects destructive pending SQL as incompatible with forward-only recovery', () => {
    expect(classifyMigrationState(
      ['20260910000000_destructive'],
      [],
      new Map([['20260910000000_destructive', 'ALTER TABLE "users" DROP COLUMN "email";']]),
    )).toEqual(expect.objectContaining({
      databaseStateVerified: false,
      pending: ['20260910000000_destructive'],
      unsafe: ['20260910000000_destructive:DROP COLUMN'],
    }));
  });

  it('derives only a bounded isolated restore database URL', () => {
    expect(isolatedRestoreDatabaseUrl(
      'postgresql://beacon:secret@postgres:5432/beacon?schema=public',
      'hb_restore_42',
    )).toBe('postgresql://beacon:secret@postgres:5432/hb_restore_42?schema=public');
    expect(() => isolatedRestoreDatabaseUrl('postgresql://postgres/beacon', 'beacon')).toThrow(/restore database name/);
    expect(() => isolatedRestoreDatabaseUrl('postgresql://postgres/beacon', '../beacon')).toThrow(/restore database name/);
  });
});
