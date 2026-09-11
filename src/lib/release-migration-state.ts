import { createHash } from 'node:crypto';

export type MigrationRecord = {
  migrationName: string;
  checksum: string | null;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

export type MigrationChecksum = {
  migrationName: string;
  checksum: string;
};

export type MigrationState = {
  schemaVersion: 'harmonic-beacon.migration-state.v1';
  databaseStateVerified: boolean;
  applied: string[];
  pending: string[];
  failed: string[];
  unexpected: string[];
  unsafe: string[];
  checksumErrors: string[];
  duplicateRecords: string[];
  conflictingRecords: string[];
  migrationChecksums: MigrationChecksum[];
};

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*))*`;
const STRING = String.raw`'(?:''|[^'])*'`;

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

export function migrationChecksum(sql: string | Buffer): string {
  return createHash('sha256').update(typeof sql === 'string' ? Buffer.from(sql, 'utf8') : sql).digest('hex');
}

type ScannedStatement = { sql: string; tokens: string };

type ScanResult = { statements: ScannedStatement[]; violation: string | null };

function scanStatements(input: string): ScanResult {
  const statements: ScannedStatement[] = [];
  let sql = '';
  let tokens = '';
  let quote: "'" | '"' | null = null;
  let parentheses = 0;

  const push = () => {
    const normalized = sql.trim().replace(/\s+/gu, ' ');
    const normalizedTokens = tokens.trim().replace(/\s+/gu, ' ');
    if (normalized) statements.push({ sql: normalized, tokens: normalizedTokens });
    sql = '';
    tokens = '';
    parentheses = 0;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quote) {
      sql += character;
      if (character === quote && next === quote) {
        sql += next;
        tokens += quote === "'" ? "''" : '""';
        index += 1;
      } else if (character === quote) {
        tokens += quote === "'" ? "'" : '"';
        quote = null;
      } else if (character === '\n' || character === '\r' || character === '\t') {
        tokens += ' ';
      } else {
        tokens += ' ';
      }
      continue;
    }
    if ((character === '-' && next === '-') || (character === '/' && next === '*') ||
        (character === '*' && next === '/')) return { statements: [], violation: 'COMMENT' };
    if (character === '$') return { statements: [], violation: 'DYNAMIC SQL' };
    if (character === "'" || character === '"') {
      quote = character;
      sql += character;
      tokens += character;
      continue;
    }
    if (character === '(') parentheses += 1;
    if (character === ')') {
      parentheses -= 1;
      if (parentheses < 0) return { statements: [], violation: 'AMBIGUOUS SQL' };
    }
    if (character === ';') {
      if (parentheses !== 0) return { statements: [], violation: 'AMBIGUOUS SQL' };
      push();
      continue;
    }
    sql += character;
    tokens += character;
  }
  if (quote || parentheses !== 0) return { statements: [], violation: 'AMBIGUOUS SQL' };
  push();
  return { statements, violation: null };
}

function hasTopLevelComma(input: string): boolean {
  let quote: "'" | '"' | null = null;
  let parentheses = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quote) {
      if (character === quote && next === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === ',' && parentheses === 0) return true;
  }
  return false;
}

function statementViolation(statement: ScannedStatement): string | null {
  const sql = statement.sql;
  const tokens = statement.tokens.toUpperCase();
  if (/\bDROP\b/u.test(tokens)) return 'DROP';
  if (/\bTRUNCATE\b/u.test(tokens)) return 'TRUNCATE';
  if (/\bDELETE\b/u.test(tokens)) return 'DELETE';
  if (/\b(?:EXECUTE|PREPARE|DEALLOCATE|CALL)\b/u.test(tokens)) return 'DYNAMIC SQL';
  if (/^ALTER\s+TABLE\b/iu.test(sql) && hasTopLevelComma(sql)) return 'ALTER TABLE';

  const allowed = [
    new RegExp(String.raw`^CREATE\s+TYPE\s+${IDENTIFIER}\s+AS\s+ENUM\s*\(\s*${STRING}(?:\s*,\s*${STRING})*\s*\)$`, 'iu'),
    new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}\s*\(.+\)$`, 'iu'),
    new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}\s+ON\s+${IDENTIFIER}\s*(?:USING\s+[A-Za-z_][A-Za-z0-9_]*\s*)?\(.+\)(?:\s+WHERE\s+.+)?$`, 'iu'),
    new RegExp(String.raw`^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}$`, 'iu'),
    new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?${IDENTIFIER}\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?.+$`, 'iu'),
    new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?${IDENTIFIER}\s+ADD\s+CONSTRAINT\s+${IDENTIFIER}\s+.+$`, 'iu'),
    new RegExp(String.raw`^ALTER\s+TYPE\s+${IDENTIFIER}\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?${STRING}(?:\s+(?:BEFORE|AFTER)\s+${STRING})?$`, 'iu'),
    new RegExp(String.raw`^INSERT\s+INTO\s+${IDENTIFIER}(?:\s*\([^)]*\))?\s+VALUES\s*\(.+\)(?:\s*,\s*\(.+\))*(?:\s+ON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+NOTHING)?$`, 'iu'),
  ];
  if (allowed.some((pattern) => pattern.test(sql))) return null;
  if (/^ALTER\s+TABLE\b/iu.test(sql)) return 'ALTER TABLE';
  if (/^ALTER\s+TYPE\b/iu.test(sql)) return 'ALTER TYPE';
  return 'NOT ALLOWLISTED';
}

export function validateForwardOnlyMigration(input: string | Buffer): { safe: boolean; violations: string[] } {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  if (text.includes('\u0000') || !Buffer.from(text, 'utf8').equals(typeof input === 'string' ? Buffer.from(input, 'utf8') : input)) {
    return { safe: false, violations: ['AMBIGUOUS SQL'] };
  }
  const scanned = scanStatements(text);
  if (scanned.violation) return { safe: false, violations: [scanned.violation] };
  if (scanned.statements.length === 0) return { safe: false, violations: ['EMPTY SQL'] };
  const violations = uniqueSorted(scanned.statements.map(statementViolation).filter((value): value is string => value !== null));
  return { safe: violations.length === 0, violations };
}

function recordFingerprint(record: MigrationRecord): string {
  return JSON.stringify([
    record.checksum,
    record.finishedAt !== null,
    record.rolledBackAt !== null,
  ]);
}

export function classifyMigrationState(
  candidateMigrations: string[],
  records: MigrationRecord[],
  migrationSql: ReadonlyMap<string, string | Buffer>,
): MigrationState {
  const candidate = uniqueSorted(candidateMigrations);
  const candidateSet = new Set(candidate);
  const byName = new Map<string, MigrationRecord[]>();
  for (const record of records) {
    const grouped = byName.get(record.migrationName) ?? [];
    grouped.push(record);
    byName.set(record.migrationName, grouped);
  }

  const duplicateRecords: string[] = [];
  const conflictingRecords: string[] = [];
  const checksumErrors: string[] = [];
  const applied: string[] = [];
  const failed: string[] = [];
  const migrationChecksums: MigrationChecksum[] = [];

  for (const migrationName of candidate) {
    const sql = migrationSql.get(migrationName);
    const expectedChecksum = sql === undefined ? null : migrationChecksum(sql);
    if (expectedChecksum) migrationChecksums.push({ migrationName, checksum: expectedChecksum });
    else checksumErrors.push(`${migrationName}:MISSING MIGRATION SQL`);

    const matching = byName.get(migrationName) ?? [];
    if (matching.length > 1) {
      duplicateRecords.push(migrationName);
      if (new Set(matching.map(recordFingerprint)).size > 1) conflictingRecords.push(migrationName);
    }
    for (const record of matching) {
      if (!record.checksum) checksumErrors.push(`${migrationName}:MISSING CHECKSUM`);
      else if (!SHA256.test(record.checksum) || expectedChecksum === null || record.checksum !== expectedChecksum) {
        checksumErrors.push(`${migrationName}:CHECKSUM MISMATCH`);
      }
      if (record.finishedAt && !record.rolledBackAt) applied.push(migrationName);
      if (!record.finishedAt && !record.rolledBackAt) failed.push(migrationName);
    }
  }

  const unexpected = uniqueSorted(records.filter((record) => !candidateSet.has(record.migrationName)).map((record) => record.migrationName));
  const appliedSet = new Set(applied);
  const pending = candidate.filter((migration) => !appliedSet.has(migration));
  const unsafe: string[] = [];
  for (const migrationName of pending) {
    const sql = migrationSql.get(migrationName);
    if (sql === undefined) {
      unsafe.push(`${migrationName}:MISSING SQL`);
      continue;
    }
    for (const violation of validateForwardOnlyMigration(sql).violations) unsafe.push(`${migrationName}:${violation}`);
  }

  const normalized = {
    applied: uniqueSorted(applied),
    pending,
    failed: uniqueSorted(failed),
    unexpected,
    unsafe: uniqueSorted(unsafe),
    checksumErrors: uniqueSorted(checksumErrors),
    duplicateRecords: uniqueSorted(duplicateRecords),
    conflictingRecords: uniqueSorted(conflictingRecords),
    migrationChecksums,
  };
  return {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: normalized.failed.length === 0 && normalized.unexpected.length === 0 &&
      normalized.unsafe.length === 0 && normalized.checksumErrors.length === 0 &&
      normalized.duplicateRecords.length === 0 && normalized.conflictingRecords.length === 0,
    ...normalized,
  };
}

export function isolatedRestoreDatabaseUrl(databaseUrl: string, restoreDatabaseName: string): string {
  if (!/^hb_restore_[a-z0-9_]{1,48}$/u.test(restoreDatabaseName)) {
    throw new Error('restore database name must be an isolated hb_restore_* identifier');
  }
  const url = new URL(databaseUrl);
  url.pathname = `/${restoreDatabaseName}`;
  return url.toString();
}
