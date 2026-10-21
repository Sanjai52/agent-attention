/**
 * SQLite bootstrap (PRD.md §10 D-04, §15).
 *
 * `node:sqlite` is built into Node 24, so there is no native module or
 * postinstall step. The Notification Host is the single writer (PRD §9.2), but
 * the bootstrap still configures WAL, foreign keys, and an explicit busy
 * timeout because `DatabaseSync` defaults the timeout to zero.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  StorageError,
  describeError,
  translateSqliteError,
} from "./errors";
import { migrate, type MigrationResult } from "./migrations";
import type { Migration } from "./schema.sql";

export const DEFAULT_BUSY_TIMEOUT_MS = 2000;

export interface OpenDatabaseOptions {
  /** Explicit lock wait; `node:sqlite` defaults to 0 (fail immediately). */
  busyTimeoutMs?: number;
  /** Apply pending migrations during open (default true). */
  autoMigrate?: boolean;
  /** Override the migration list (tests and future schemas). */
  migrations?: readonly Migration[];
  /** Back up a non-empty database before an upgrade (default true). */
  backupOnUpgrade?: boolean;
}

export interface AgentAttentionDb {
  readonly path: string;
  /** Raw `node:sqlite` handle for repositories and diagnostics. */
  readonly raw: DatabaseSync;
  /** Alias for `raw`, matching the repository naming used in the plan. */
  readonly db: DatabaseSync;
  readonly closed: boolean;
  close(): void;
  /** Run `fn` in `BEGIN IMMEDIATE`, committing on success and rolling back on error. */
  transaction<T>(fn: () => T): T;
}

function isInMemory(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

class SqliteAgentAttentionDb implements AgentAttentionDb {
  readonly path: string;
  readonly raw: DatabaseSync;
  #closed = false;
  #transactionDepth = 0;

  constructor(path: string, raw: DatabaseSync) {
    this.path = path;
    this.raw = raw;
  }

  get db(): DatabaseSync {
    return this.raw;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.raw.close();
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();

    // Nested calls join the outer transaction; repositories compose writes
    // without accidentally starting a second BEGIN.
    if (this.#transactionDepth > 0) {
      this.#transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.raw.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;

    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        // A failed ROLLBACK leaves the original error as the useful signal;
        // SQLite has already aborted the transaction on most failures.
      }
      throw error;
    } finally {
      this.#transactionDepth = 0;
    }
  }

  assertOpen(): void {
    if (this.#closed) {
      throw new StorageError("database_error", "the database connection is closed");
    }
  }
}

function configure(raw: DatabaseSync, busyTimeoutMs: number): void {
  raw.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA synchronous = NORMAL");
}

/**
 * Open (and by default migrate) the local database.
 *
 * A database held under another writer's lock fails with
 * `StorageError.code === "database_locked"`; the file is left untouched.
 */
export function openDatabase(
  path: string,
  options: OpenDatabaseOptions = {},
): AgentAttentionDb {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;

  if (!isInMemory(path)) {
    mkdirSync(dirname(path), { recursive: true });
  }

  let raw: DatabaseSync;
  try {
    raw = new DatabaseSync(path);
  } catch (error) {
    throw translateSqliteError(error, `open ${path}`);
  }

  const db = new SqliteAgentAttentionDb(path, raw);

  try {
    configure(raw, busyTimeoutMs);

    if (options.autoMigrate !== false) {
      migrate(db, {
        migrations: options.migrations,
        backup: options.backupOnUpgrade,
      });
    }

    // Prove this connection can take the write lock now. Opening SQLite is
    // lazy under WAL, so without this probe a second host would appear healthy
    // until its first event arrived.
    db.transaction(() => undefined);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the original failure.
    }
    throw translateSqliteError(error, `open ${path}`);
  }
}

/** Convenience re-export so callers can open-and-migrate in one step. */
export function openAndMigrate(
  path: string,
  options: OpenDatabaseOptions = {},
): { db: AgentAttentionDb; migration: MigrationResult } {
  const db = openDatabase(path, { ...options, autoMigrate: false });
  try {
    const migration = migrate(db, {
      migrations: options.migrations,
      backup: options.backupOnUpgrade,
    });
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}

export { describeError };
