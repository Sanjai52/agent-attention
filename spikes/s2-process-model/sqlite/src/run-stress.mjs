// Throwaway S2 probe: orchestrates 3 concurrent writers, then verifies the
// database is intact and every acknowledged row is present.
//
// Usage: node src/run-stress.mjs <node|better> [workers] [countPerWorker]

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [which, workersArg = '3', countArg = '50'] = process.argv.slice(2);
const workers = Number(workersArg);
const count = Number(countArg);
const dbPath = resolve(fileURLToPath(new URL(`../out/stress-${which}.db`, import.meta.url)));
const probeScript = fileURLToPath(new URL('./probe.mjs', import.meta.url));
const writerScript = fileURLToPath(new URL('./stress-writer.mjs', import.meta.url));

const seed = spawn(process.execPath, [probeScript, which, dbPath], { stdio: ['ignore', 'ignore', 'inherit'] });
const [seedCode] = await once(seed, 'exit');
if (seedCode !== 0) process.exit(1);

const started = performance.now();
const results = await Promise.all(
  Array.from({ length: workers }, async (_, index) => {
    const child = spawn(process.execPath, [writerScript, which, dbPath, String(index), String(count)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    const [code] = await once(child, 'exit');
    return { code, output: output.trim() };
  }),
);
for (const result of results) {
  console.log(result.output);
  if (result.code !== 0) console.log(JSON.stringify({ step: 'writer_exit', code: result.code }));
}
console.log(JSON.stringify({
  step: 'stress_elapsed',
  binding: which,
  workers,
  countEach: count,
  ms: Number((performance.now() - started).toFixed(1)),
}));

const verify = spawn(process.execPath, [
  '-e',
  which === 'node'
    ? `import('node:sqlite').then(({DatabaseSync})=>{const d=new DatabaseSync(${JSON.stringify(dbPath)});console.log(JSON.stringify({step:'verify',count:d.prepare('SELECT COUNT(*) AS n FROM t').get().n,integrity:d.prepare('PRAGMA integrity_check').get().integrity_check,journal:d.prepare('PRAGMA journal_mode').get().journal_mode}));d.close()})`
    : `import('better-sqlite3').then(({default:D})=>{const d=new D(${JSON.stringify(dbPath)});console.log(JSON.stringify({step:'verify',count:d.prepare('SELECT COUNT(*) AS n FROM t').get().n,integrity:d.pragma('integrity_check',{simple:true}),journal:d.pragma('journal_mode',{simple:true})}));d.close()})`,
], { stdio: ['ignore', 'pipe', 'inherit'] });
let verifyOut = '';
verify.stdout.on('data', (chunk) => { verifyOut += chunk; });
const [verifyCode] = await once(verify, 'exit');
console.log(verifyOut.trim());
if (verifyCode !== 0) process.exit(1);
