import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  StorageError,
  getSchemaVersion,
  migrate,
  openDatabase,
  type AgentAttentionDb,
  type Migration,
} from "@agent-attention/storage";

const EXPECTED_TABLES = [
  "agent_events",
  "agent_sessions",
  "agent_tasks",
  "dedupe_records",
  "event_deliveries",
  "pending_requests",
  "schema_migrations",
] as const;

const dirs: string[] = [];

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-attention-storage-"));
  dirs.push(dir);
  return join(dir, "agent-attention.db");
}

function tableNames(db: AgentAttentionDb): string[] {
  return (
    db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("database bootstrap", () => {
  it("creates the PRD §15.1 schema and records migration version 1 on a fresh database", () => {
    const path = tempDatabasePath();
    const db = openDatabase(path, { busyTimeoutMs: 250 });

    expect(tableNames(db)).toEqual([...EXPECTED_TABLES]);
    expect(getSchemaVersion(db)).toBe(1);
    expect(db.raw.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
    expect(db.raw.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    expect(db.raw.prepare("PRAGMA busy_timeout").get()).toMatchObject({ timeout: 250 });

    const rows = db.raw
      .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; applied_at: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(Number.isNaN(Date.parse(rows[0]?.applied_at ?? ""))).toBe(false);

    db.close();
  });

  it("is idempotent when an existing current database is reopened", () => {
    const path = tempDatabasePath();
    const first = openDatabase(path);
    first.close();

    const second = openDatabase(path);
    expect(getSchemaVersion(second)).toBe(1);
    expect(tableNames(second)).toEqual([...EXPECTED_TABLES]);
    const count = second.raw.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
      count: number;
    };
    expect(count.count).toBe(1);
    second.close();
  });

  it("does not create a preferences table (D-05)", () => {
    const db = openDatabase(tempDatabasePath());
    expect(tableNames(db)).not.toContain("preferences");
    db.close();
  });
});

describe("forward-only migrations", () => {
  it("backs up the previous file before applying an upgrade", () => {
    const path = tempDatabasePath();
    const first = openDatabase(path, { migrations: [MIGRATIONS[0]!] });
    first.close();

    const v2: Migration = {
      version: 2,
      description: "add a migration probe table",
      sql: "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, value TEXT);",
    };

    const db = openDatabase(path, {
      migrations: [MIGRATIONS[0]!],
      autoMigrate: false,
    });
    const result = migrate(db, { migrations: [MIGRATIONS[0]!, v2] });

    expect(result).toMatchObject({ from: 1, to: 2 });
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(result.backupPath).not.toBe(path);
    expect(getSchemaVersion(db)).toBe(2);
    expect(tableNames(db)).toContain("migration_probe");

    const backup = openDatabase(result.backupPath!, { autoMigrate: false });
    expect(getSchemaVersion(backup)).toBe(1);
    expect(tableNames(backup)).not.toContain("migration_probe");
    backup.close();
    db.close();
  });

  it("rolls back a failed migration and leaves the previous version intact", () => {
    const path = tempDatabasePath();
    const first = openDatabase(path, { migrations: [MIGRATIONS[0]!] });
    first.close();

    const broken: Migration = {
      version: 2,
      description: "fails halfway through",
      sql: [
        "CREATE TABLE should_not_survive (id INTEGER PRIMARY KEY);",
        "INSERT INTO table_that_does_not_exist (id) VALUES (1);",
      ].join("\n"),
    };

    const db = openDatabase(path, {
      migrations: [MIGRATIONS[0]!],
      autoMigrate: false,
    });

    let caught: unknown;
    try {
      migrate(db, { migrations: [MIGRATIONS[0]!, broken] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageError);
    expect((caught as StorageError).code).toBe("migration_failed");
    expect(getSchemaVersion(db)).toBe(1);
    expect(tableNames(db)).not.toContain("should_not_survive");
    expect(db.raw.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
    db.close();
  });

  it("rejects a database written by a newer schema instead of downgrading it", () => {
    const path = tempDatabasePath();
    const v2: Migration = {
      version: 2,
      description: "newer schema",
      sql: "CREATE TABLE newer_table (id INTEGER PRIMARY KEY);",
    };

    const db = openDatabase(path, { migrations: [MIGRATIONS[0]!, v2] });
    expect(getSchemaVersion(db)).toBe(2);

    let caught: unknown;
    try {
      migrate(db, { migrations: [MIGRATIONS[0]!] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageError);
    expect((caught as StorageError).code).toBe("schema_too_new");
    expect(getSchemaVersion(db)).toBe(2);
    db.close();
  });
});

describe("locking", () => {
  it("fails with a typed locked error when another connection holds the write lock", () => {
    const path = tempDatabasePath();
    const holder = openDatabase(path, { busyTimeoutMs: 100 });
    holder.raw.exec("BEGIN IMMEDIATE");

    let caught: unknown;
    try {
      openDatabase(path, { busyTimeoutMs: 25 });
    } catch (error) {
      caught = error;
    } finally {
      holder.raw.exec("ROLLBACK");
    }

    expect(caught).toBeInstanceOf(StorageError);
    expect((caught as StorageError).code).toBe("database_locked");
    expect(holder.raw.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
    holder.close();

    const reopened = openDatabase(path, { busyTimeoutMs: 25 });
    expect(getSchemaVersion(reopened)).toBe(1);
    reopened.close();
  });
});
