/**
 * Forward-only migration runner (PRD.md §15).
 *
 * Rules:
 * - pending migrations run in ascending version order inside one transaction;
 * - a non-empty database is backed up before any upgrade;
 * - a failed migration rolls back completely and leaves the previous version;
 * - a database from a newer schema is rejected, never downgraded.
 */

import { existsSync } from "node:fs";
import type { AgentAttentionDb } from "./db";
import {
  MigrationError,
  StorageError,
  isStorageError,
  isSqliteLockedError,
  translateSqliteError,
} from "./errors";
import { DEFAULT_MIGRATIONS, type Migration } from "./schema.sql";

export interface MigrateOptions {
  migrations?: readonly Migration[];
  /** Back up before upgrading a non-empty database (default true). */
  backup?: boolean;
  /** Override the backup destination; otherwise a timestamped sibling is used. */
  backupPath?: string;
  /** Timestamp recorded in `schema_migrations.applied_at`. */
  now?: string;
}

export interface MigrationResult {
  from: number;
  to: number;
  backupPath?: string;
}

function tableExists(db: AgentAttentionDb, name: string): boolean {
  const row = db.raw
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/** Current version, or 0 when the database has never been migrated. */
export function getSchemaVersion(db: AgentAttentionDb): number {
  if (!tableExists(db, "schema_migrations")) {
    return 0;
  }

  const row = db.raw
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version?: number | bigint } | undefined;

  return Number(row?.version ?? 0);
}

function validateMigrations(migrations: readonly Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set<number>();

  for (const migration of sorted) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new StorageError(
        "invalid_input",
        `migration version must be a positive integer (received ${String(migration.version)})`,
      );
    }
    if (seen.has(migration.version)) {
      throw new StorageError(
        "invalid_input",
        `duplicate migration version ${migration.version}`,
      );
    }
    seen.add(migration.version);
  }

  return sorted;
}

function backupPathFor(db: AgentAttentionDb, from: number, requested?: string): string {
  if (requested !== undefined) {
    return requested;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${db.path}.backup-v${from}-${stamp}`;
  let candidate = `${base}.db`;
  let suffix = 1;

  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}.db`;
    suffix += 1;
  }

  return candidate;
}

function createBackup(
  db: AgentAttentionDb,
  from: number,
  requested?: string,
): string {
  const backupPath = backupPathFor(db, from, requested);

  try {
    db.raw.prepare("VACUUM INTO ?").run(backupPath);
    return backupPath;
  } catch (error) {
    if (isSqliteLockedError(error)) {
      throw translateSqliteError(error, "migration backup");
    }
    throw new MigrationError(`could not back up the database before migration: ${String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Apply all pending migrations. Safe to call on a current database; it then
 * performs no writes and reports `from === to`.
 */
export function migrate(
  db: AgentAttentionDb,
  options: MigrateOptions = {},
): MigrationResult {
  const migrations = validateMigrations(options.migrations ?? DEFAULT_MIGRATIONS);
  const from = getSchemaVersion(db);
  const target = migrations.at(-1)?.version ?? 0;

  if (from > target) {
    throw new StorageError(
      "schema_too_new",
      `database schema version ${from} is newer than the supported version ${target}`,
    );
  }

  if (from === target) {
    return { from, to: target };
  }

  const pending = migrations.filter((migration) => migration.version > from);
  const isFileDatabase = db.path !== ":memory:" && !db.path.startsWith("file::memory:");

  // A backup is only useful when there is an existing file to restore.
  const backupPath =
    from > 0 && isFileDatabase && options.backup !== false
      ? createBackup(db, from, options.backupPath)
      : undefined;

  const appliedAt = options.now ?? new Date().toISOString();

  try {
    db.transaction(() => {
      for (const migration of pending) {
        db.raw.exec(migration.sql);
        // Prepared after the DDL: version 1 creates schema_migrations itself.
        db.raw
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, appliedAt);
      }
    });
  } catch (error) {
    if (isStorageError(error)) {
      throw error;
    }
    if (isSqliteLockedError(error)) {
      throw translateSqliteError(error, `migrate to version ${target}`);
    }
    throw new MigrationError(
      `migration to version ${target} failed and was rolled back: ${String(error)}`,
      { cause: error },
    );
  }

  return {
    from,
    to: target,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
}

export function listAppliedMigrations(
  db: AgentAttentionDb,
): Array<{ version: number; appliedAt: string }> {
  if (!tableExists(db, "schema_migrations")) {
    return [];
  }

  const rows = db.raw
    .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number | bigint; applied_at: string }>;

  return rows.map((row) => ({
    version: Number(row.version),
    appliedAt: row.applied_at,
  }));
}
