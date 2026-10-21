/**
 * Typed storage failures (PRD.md §9.4 D, §15).
 *
 * Storage never throws raw SQLite errors at the host boundary: callers get a
 * stable `code` they can map to an IPC error or a diagnostic without parsing
 * driver messages. A locked database is reported as `database_locked` and is
 * never treated as corruption.
 */

export type StorageErrorCode =
  "database_locked" | "database_error" | "migration_failed" | "schema_too_new" | "invalid_input";

export interface StorageErrorOptions {
  cause?: unknown;
}

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options: StorageErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StorageError";
    this.code = code;
  }
}

/** A migration failed; the database remains at its previous version. */
export class MigrationError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super("migration_failed", message, options);
    this.name = "MigrationError";
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

interface SqliteErrorLike {
  code?: unknown;
  errcode?: unknown;
  errstr?: unknown;
  message?: unknown;
}

function isSqliteErrorLike(error: unknown): error is SqliteErrorLike {
  return typeof error === "object" && error !== null;
}

/** SQLite primary result code (the low byte of the extended code). */
export function sqliteResultCode(error: unknown): number | undefined {
  if (!isSqliteErrorLike(error)) {
    return undefined;
  }

  const extended = error.errcode;
  if (typeof extended !== "number") {
    return undefined;
  }

  return extended & 0xff;
}

/**
 * `SQLITE_BUSY` (5) and `SQLITE_LOCKED` (6) are transient contention, not
 * corruption. The host maps them to an unavailable response and retries later.
 */
export function isSqliteLockedError(error: unknown): boolean {
  const code = sqliteResultCode(error);
  return code === 5 || code === 6;
}

export function describeError(error: unknown): string {
  if (!isSqliteErrorLike(error)) {
    return String(error);
  }

  const message = typeof error.message === "string" ? error.message : "SQLite failure";
  const errstr = typeof error.errstr === "string" ? ` (${error.errstr})` : "";
  return `${message}${errstr}`;
}

/** Translate a driver error into the storage error boundary. */
export function translateSqliteError(error: unknown, context: string): StorageError {
  if (isStorageError(error)) {
    return error;
  }

  if (isSqliteLockedError(error)) {
    return new StorageError(
      "database_locked",
      `${context}: the database is locked by another writer`,
      { cause: error },
    );
  }

  return new StorageError("database_error", `${context}: ${describeError(error)}`, {
    cause: error,
  });
}
