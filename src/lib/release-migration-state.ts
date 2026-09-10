export type MigrationRecord = {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

export type MigrationState = {
  schemaVersion: 'harmonic-beacon.migration-state.v1';
  databaseStateVerified: boolean;
  applied: string[];
  pending: string[];
  failed: string[];
  unexpected: string[];
  unsafe: string[];
};

const FORWARD_ONLY_DENYLIST: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/iu, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/iu, 'DROP COLUMN'],
  [/\bTRUNCATE\b/iu, 'TRUNCATE'],
  [/\bDELETE\s+FROM\b/iu, 'DELETE FROM'],
  [/\bALTER\s+(?:TABLE|TYPE)\b[\s\S]*?\bRENAME\b/iu, 'RENAME'],
];

export function isolatedRestoreDatabaseUrl(databaseUrl: string, databaseName: string): string {
  if (!/^hb_restore_[1-9][0-9]{0,19}$/u.test(databaseName)) {
    throw new Error('restore database name must be bound to an Actions run id');
  }
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('restore requires a PostgreSQL database URL');
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export function classifyMigrationState(
  candidateMigrations: string[],
  databaseRecords: MigrationRecord[],
  migrationSql: ReadonlyMap<string, string> = new Map(),
): MigrationState {
  const candidate = [...new Set(candidateMigrations)].sort();
  const candidateSet = new Set(candidate);
  const applied = new Set<string>();
  const failed = new Set<string>();
  const unexpected = new Set<string>();

  for (const record of databaseRecords) {
    if (!candidateSet.has(record.migrationName)) unexpected.add(record.migrationName);
    if (record.rolledBackAt) continue;
    if (record.finishedAt) applied.add(record.migrationName);
    else failed.add(record.migrationName);
  }
  const pending = candidate.filter((name) => !applied.has(name));
  const unsafe = pending.flatMap((name) => {
    const sql = migrationSql.get(name) ?? '';
    return FORWARD_ONLY_DENYLIST
      .filter(([pattern]) => pattern.test(sql))
      .map(([, operation]) => `${name}:${operation}`);
  });
  return {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: failed.size === 0 && unexpected.size === 0 && unsafe.length === 0,
    applied: [...applied].sort(),
    pending,
    failed: [...failed].sort(),
    unexpected: [...unexpected].sort(),
    unsafe,
  };
}
