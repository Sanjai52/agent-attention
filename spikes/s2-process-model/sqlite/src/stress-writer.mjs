// Throwaway S2 probe: N processes write concurrently under WAL. Used only to
// check that lock contention surfaces as errors/retries and never corrupts the
// file. Production has a single writer (PRD D-04); this is a robustness bound.
//
// Usage: node src/stress-writer.mjs <node|better> <dbPath> <workerId> <count>

import { DatabaseSync } from 'node:sqlite';
import Database from 'better-sqlite3';

const [which, dbPath, workerId, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 50);

const db = which === 'node'
  ? new DatabaseSync(dbPath, { timeout: 5000 })
  : new Database(dbPath);
if (which === 'better') db.pragma('busy_timeout = 5000');

let inserted = 0;
let busyRetries = 0;
const errors = [];
const started = performance.now();

for (let i = 0; i < count; i += 1) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      db.prepare('INSERT INTO t (name) VALUES (?)').run(`w${workerId}-${i}`);
      inserted += 1;
      break;
    } catch (error) {
      if (error?.errcode === 5 || error?.code === 'SQLITE_BUSY') {
        busyRetries += 1;
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
        continue;
      }
      errors.push({ message: error?.message, code: error?.code ?? null });
      break;
    }
  }
}

db.close();
console.log(JSON.stringify({
  step: 'writer_done',
  binding: which,
  workerId,
  inserted,
  busyRetries,
  errors,
  ms: Number((performance.now() - started).toFixed(1)),
}));
