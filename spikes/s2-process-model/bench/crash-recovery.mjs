import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ROOT, OUT, HOST, ensureDir, killPidSync, writeJson } from './lib.mjs';

const dir = ensureDir(path.join(OUT, 'crash'));
const results = { at: new Date().toISOString(), node: process.version, iterations: [], deterministic: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verify(dataRoot) {
  const r = spawnSync(process.execPath, [HOST, '--verify-only', '--data-root', dataRoot], { encoding: 'utf8', windowsHide: true });
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  try { return { exit: r.status, ...JSON.parse(line) }; } catch { return { exit: r.status, parseError: true, stdout: r.stdout, stderr: r.stderr }; }
}

async function crashOnce(i) {
  const dataRoot = path.join(dir, `run-${i}`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
  const logFile = path.join(dataRoot, 'host.jsonl');
  const child = spawn(process.execPath, [HOST, '--crash-writer', '--data-root', dataRoot, '--log', logFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { stdout += d; });
  // wait until the writer has committed a few records, then kill mid-stream
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (stdout.match(/WROTE /g) || []).length < 5) await sleep(5);
  await sleep(20 + Math.floor(Math.random() * 120));
  const tKill = performance.now();
  const killResult = killPidSync(child.pid);
  await new Promise((resolve) => { const t = setTimeout(resolve, 3000); child.on('exit', () => { clearTimeout(t); resolve(); }); });
  const killMs = performance.now() - tKill;
  const wrote = (stdout.match(/WROTE (\d+)/g) || []).map((s) => Number(s.slice(6)));
  const v = verify(dataRoot);
  return {
    i,
    wroteLines: wrote.length,
    lastWroteSeq: wrote.length ? wrote[wrote.length - 1] : null,
    killExit: killResult.status,
    killMs: Number(killMs.toFixed(3)),
    recovered: v,
    sizeBytes: fs.existsSync(path.join(dataRoot, 'host-journal.jsonl')) ? fs.statSync(path.join(dataRoot, 'host-journal.jsonl')).size : 0,
  };
}

for (let i = 1; i <= 10; i++) {
  const r = await crashOnce(i);
  results.iterations.push(r);
  console.log(`crash ${i}: wrote=${r.wroteLines} last=${r.lastWroteSeq} recovered=${r.recovered.records}/${r.recovered.lastSeq} truncated=${r.recovered.truncatedBytes} contiguous=${r.recovered.contiguous}`);
}

// Deterministic torn tail: a valid journal plus half a line.
{
  const base = path.join(dir, 'torn');
  const dataRoot = path.join(base, 'data');
  ensureDir(dataRoot);
  // produce a valid 3-record journal
  const src = path.join(dir, 'run-1', 'host-journal.jsonl');
  const dst = path.join(dataRoot, 'host-journal.jsonl');
  const full = fs.existsSync(src) ? fs.readFileSync(src) : Buffer.alloc(0);
  const lines = full.toString('utf8').split('\n').filter(Boolean);
  const kept = lines.slice(0, Math.min(3, lines.length)).join('\n') + (lines.length ? '\n' : '');
  fs.writeFileSync(dst, kept);
  const before = verify(dataRoot);
  fs.appendFileSync(dst, '12345 999 {"eventId":"torn-event","sessionId":"x"');
  const torn = verify(dataRoot);
  // valid CRC line with a deliberately wrong checksum
  fs.appendFileSync(dst, '0 1000 {"eventId":"bad-crc","sessionId":"x","kind":"progress"}\n');
  const badCrc = verify(dataRoot);
  results.deterministic.tornTail = { before, torn, badCrc };
  console.log('tornTail', JSON.stringify(results.deterministic.tornTail));
}

writeJson(path.join(dir, 'crash-recovery.json'), results);
console.log('wrote ' + path.join(dir, 'crash-recovery.json'));
