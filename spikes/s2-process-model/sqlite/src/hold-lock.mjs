// Throwaway S2 probe: holds a write transaction on the DB so a second process
// can be tested against a locked database. Prints READY, holds, then exits.
//
// Usage: node src/hold-lock.mjs <node|better> <dbPath> <holdMs>

import { DatabaseSync } from 'node:sqlite';
import Database from 'better-sqlite3';

const [which, dbPath, holdArg] = process.argv.slice(2);
const holdMs = Number(holdArg ?? 3000);

if (!dbPath || (which !== 'node' && which !== 'better')) {
  console.error('usage: node src/hold-lock.mjs <node|better> <dbPath> <holdMs>');
  process.exit(2);
}

const db = which === 'node' ? new DatabaseSync(dbPath) : new Database(dbPath);
if (which === 'node') {
  db.prepare('PRAGMA busy_timeout = 0').get();
  db.exec('BEGIN IMMEDIATE');
} else {
  db.pragma('busy_timeout = 0');
  db.exec('BEGIN IMMEDIATE');
}
db.prepare('INSERT INTO t (name) VALUES (?)').run(`held-${process.pid}`);
console.log(JSON.stringify({ step: 'ready', binding: which, pid: process.pid, holdMs }));
await new Promise((resolve) => setTimeout(resolve, holdMs));
db.exec('COMMIT');
db.close();
console.log(JSON.stringify({ step: 'released', pid: process.pid }));
