// Throwaway S2 probe: runs against a DB locked by hold-lock.mjs and records how
// the binding surfaces the lock, plus whether the file stayed consistent.
//
// Usage: node src/lock-probe.mjs <node|better> <dbPath>

import { DatabaseSync } from 'node:sqlite';
import Database from 'better-sqlite3';

const [which, dbPath, mode = 'zero'] = process.argv.slice(2);
if (!dbPath || (which !== 'node' && which !== 'better')) {
  console.error('usage: node src/lock-probe.mjs <node|better> <dbPath> [zero|default]');
  process.exit(2);
}

const record = (step, data) => console.log(JSON.stringify({ step, mode, ...data }));

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
const started = performance.now();
try {
  if (which === 'node') {
    db = new DatabaseSync(dbPath, mode === 'timeout' ? { timeout: 5000 } : undefined);
    if (mode === 'zero') db.prepare('PRAGMA busy_timeout = 0').get();
  } else {
    db = new Database(dbPath);
    if (mode === 'zero') db.pragma('busy_timeout = 0');
  }
  record('open_while_locked', {
    ok: true,
    ms: Number((performance.now() - started).toFixed(2)),
    busy_timeout: which === 'node'
      ? db.prepare('PRAGMA busy_timeout').get().timeout
      : db.pragma('busy_timeout', { simple: true }),
  });
} catch (error) {
  record('open_while_locked', { ok: false, error: describeError(error) });
  process.exit(1);
}

try {
  db.prepare('INSERT INTO t (name) VALUES (?)').run(`contender-${process.pid}`);
  record('write_while_locked', { threw: false });
} catch (error) {
  record('write_while_locked', {
    threw: true,
    ms: Number((performance.now() - started).toFixed(2)),
    error: describeError(error),
  });
}

// Read is allowed under WAL even while a writer holds the write lock.
try {
  const row = db.prepare('SELECT COUNT(*) AS n FROM t').get();
  record('read_while_locked', { ok: true, rows: row.n });
} catch (error) {
  record('read_while_locked', { ok: false, error: describeError(error) });
}

try {
  const row = which === 'node'
    ? db.prepare('PRAGMA integrity_check').get()
    : { integrity_check: db.pragma('integrity_check', { simple: true }) };
  record('integrity_check', { ok: true, value: row });
} catch (error) {
  record('integrity_check', { ok: false, error: describeError(error) });
}

db.close();
record('closed', { ok: true });
