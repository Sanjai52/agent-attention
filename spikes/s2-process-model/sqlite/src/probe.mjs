// Throwaway S2 probe: exercises one SQLite binding and prints machine-readable
// observations. Do not promote; Phase 2 implements the store against PRD §12-§15.
//
// Usage: node src/probe.mjs <node|better> [dbPath]

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const which = process.argv[2];
const dbPath = resolve(
  process.argv[3] ?? fileURLToPath(new URL(`../out/probe-${which}.db`, import.meta.url)),
);

if (which !== 'node' && which !== 'better') {
  console.error('usage: node src/probe.mjs <node|better> [dbPath]');
  process.exit(2);
}

mkdirSync(dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const observations = [];
const record = (step, data) => {
  observations.push({ step, ...data });
  console.log(JSON.stringify({ step, ...data }));
};

/** Normalize a thrown SQLite error without losing the binding-specific fields. */
function describeError(error) {
  return {
    name: error?.constructor?.name ?? typeof error,
    message: error?.message,
    code: error?.code ?? null,
    errcode: error?.errcode ?? null,
    errstr: error?.errstr ?? null,
  };
}

let db;
if (which === 'node') {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(dbPath);
  record('open', {
    binding: 'node:sqlite',
    module: 'node:sqlite',
    node: process.version,
    sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
    dbPath,
  });
  record('journal_mode', { value: db.prepare('PRAGMA journal_mode = WAL').get() });
  record('busy_timeout', { value: db.prepare('PRAGMA busy_timeout = 0').get() });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');

  db.exec('BEGIN');
  db.prepare('INSERT INTO t (name) VALUES (?)').run('committed');
  db.exec('COMMIT');
  record('transaction_commit', { value: db.prepare('SELECT COUNT(*) AS n FROM t').get() });

  db.exec('BEGIN');
  db.prepare('INSERT INTO t (name) VALUES (?)').run('rolled-back');
  db.exec('ROLLBACK');
  record('transaction_rollback', { value: db.prepare('SELECT COUNT(*) AS n FROM t').get() });

  try {
    db.prepare('INSERT INTO t (name) VALUES (?)').run('committed');
    record('unique_violation', { threw: false });
  } catch (error) {
    record('unique_violation', { threw: true, error: describeError(error) });
  }

  record('integrity_check', { value: db.prepare('PRAGMA integrity_check').get() });
  record('journal_mode_after', { value: db.prepare('PRAGMA journal_mode').get() });
  db.close();
} else {
  const { default: Database } = await import('better-sqlite3');
  db = new Database(dbPath);
  const require = createRequire(import.meta.url);
  record('open', {
    binding: 'better-sqlite3',
    version: require('better-sqlite3/package.json').version,
    sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
    dbPath,
  });
  record('journal_mode', { value: db.pragma('journal_mode = WAL', { simple: true }) });
  record('busy_timeout', { value: db.pragma('busy_timeout = 0', { simple: true }) });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');

  db.exec('BEGIN');
  db.prepare('INSERT INTO t (name) VALUES (?)').run('committed');
  db.exec('COMMIT');
  record('transaction_commit', { value: db.prepare('SELECT COUNT(*) AS n FROM t').get() });

  db.exec('BEGIN');
  db.prepare('INSERT INTO t (name) VALUES (?)').run('rolled-back');
  db.exec('ROLLBACK');
  record('transaction_rollback', { value: db.prepare('SELECT COUNT(*) AS n FROM t').get() });

  try {
    db.prepare('INSERT INTO t (name) VALUES (?)').run('committed');
    record('unique_violation', { threw: false });
  } catch (error) {
    record('unique_violation', { threw: true, error: describeError(error) });
  }

  record('integrity_check', { value: db.pragma('integrity_check', { simple: true }) });
  record('journal_mode_after', { value: db.pragma('journal_mode', { simple: true }) });
  db.close();
}

record('summary', { binding: which, ok: true, steps: observations.length });
