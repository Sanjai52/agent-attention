// Throwaway S2 probe: spawns a lock holder, waits for READY, runs the contender,
// then reports both sides' output. Deterministic replacement for shell timing.
//
// Usage: node src/run-lock-test.mjs <node|better> <zero|default> [dbPath]

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [which, mode = 'zero'] = process.argv.slice(2);
const dbPath = resolve(
  process.argv[4] ??
    fileURLToPath(new URL(`../out/lock-${which}-${mode}.db`, import.meta.url)),
);
const holderScript = fileURLToPath(new URL('./hold-lock.mjs', import.meta.url));
const probeScript = fileURLToPath(new URL('./lock-probe.mjs', import.meta.url));

/** @param {import('node:child_process').ChildProcess} child */
async function collect(child) {
  const lines = [];
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    lines.push(line);
    console.log(line);
  });
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const [code] = await once(child, 'exit');
  return { code, lines };
}

// Seed schema with the same shape the probe expects.
const seed = spawn(process.execPath, [probeScript.replace('lock-probe', 'probe'), which, dbPath], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const [seedCode] = await once(seed, 'exit');
if (seedCode !== 0) {
  console.error(`seed failed: ${seedCode}`);
  process.exit(1);
}

const holder = spawn(process.execPath, [holderScript, which, dbPath, '2500'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const holderExit = once(holder, 'exit');
const holderLines = [];
const rl = createInterface({ input: holder.stdout });
const ready = new Promise((resolveReady) => {
  rl.on('line', (line) => {
    holderLines.push(line);
    console.log(`holder: ${line}`);
    if (line.includes('"step":"ready"')) resolveReady();
  });
});
await ready;

const contender = spawn(process.execPath, [probeScript, which, dbPath, mode], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const contenderResult = await collect(contender);

const holderCode = (await holderExit)[0];
console.error(
  JSON.stringify({
    step: 'runner_summary',
    binding: which,
    mode,
    dbPath,
    holderExit: holderCode,
    contenderExit: contenderResult.code,
  }),
);
