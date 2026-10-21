import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
  ROOT, OUT, SHIM, CLIENT, HOST, ensureDir, kill, killPidSync, percentile, ping, readLog, runNode,
  sleep, spawnHost, stats, waitGone, waitReady, writeJson,
} from './lib.mjs';

const RUN = `s2-${Date.now()}`;
const results = { run: RUN, startedAt: new Date().toISOString(), node: process.version, sections: {} };
const log = (...a) => console.log(...a);

function summary(values) {
  return stats(values);
}

function fresh(name) {
  const dir = ensureDir(path.join(OUT, name));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  return dir;
}

async function stopHost(suffix, child) {
  if (child && child.pid) kill(child.pid);
  await waitGone(suffix, 4000);
}

// ---------------------------------------------------------------- host cold start
async function hostColdStart(n = 10) {
  const dir = fresh('host-cold');
  const samples = [];
  const logSamples = [];
  for (let i = 0; i < n; i++) {
    const suffix = `${RUN}-hc-${i}`;
    const dataRoot = path.join(dir, `d${i}`);
    const logFile = path.join(dataRoot, 'host.jsonl');
    const child = spawnHost({ suffix, dataRoot, log: logFile, idleMs: 600000 });
    const ready = await waitReady(suffix, 15000);
    samples.push(ready.ms);
    const lines = readLog(logFile);
    const listening = lines.find((l) => l.event === 'listening');
    const boot = lines.find((l) => l.event === 'boot');
    logSamples.push({ i, externalMs: Number(ready.ms.toFixed(3)), bootToListeningMs: listening && boot ? Number((listening.monoMs - boot.monoMs).toFixed(3)) : null, hostPid: child.pid });
    await stopHost(suffix, child);
    log(`host-cold ${i + 1}/${n}: ${ready.ms.toFixed(1)} ms (pid ${child.pid})`);
  }
  results.sections.hostColdStart = { samples, ...summary(samples), raw: logSamples };
  return results.sections.hostColdStart;
}

// ---------------------------------------------------------------- warm shim
async function warmShim(n = 100) {
  const dir = fresh('shim-warm');
  const dataRoot = path.join(dir, 'data');
  const suffix = `${RUN}-warm`;
  const hostLog = path.join(dir, 'host.jsonl');
  const child = spawnHost({ suffix, dataRoot, log: hostLog, idleMs: 600000 });
  await waitReady(suffix);
  const external = [];
  const internal = [];
  const outcomes = {};
  for (let i = 0; i < n; i++) {
    const mdir = path.join(dir, 'm', String(i));
    ensureDir(mdir);
    const started = performance.now();
    const r = await runNode(SHIM, ['--pipe-suffix', suffix, '--data-root', dataRoot, '--metrics-dir', mdir, '--session', 'warm', '--seq', String(i + 1), '--kind', 'turn_ended'], 15000);
    const wall = performance.now() - started;
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    const m = files.length ? JSON.parse(fs.readFileSync(path.join(mdir, files[0]), 'utf8')) : null;
    external.push(wall);
    if (m) internal.push(m.durationMs);
    const key = m ? m.outcome : `exit-${r.code}`;
    outcomes[key] = (outcomes[key] || 0) + 1;
    if ((i + 1) % 20 === 0) log(`shim-warm ${i + 1}/${n}`);
  }
  await stopHost(suffix, child);
  results.sections.warmShim = { samplesExternallyMeasuredMs: external, ...summary(external), internalShimMs: { ...summary(internal) }, outcomes, n };
  return results.sections.warmShim;
}

// ---------------------------------------------------------------- cold shim (host stopped)
async function coldShim(n = 10) {
  const dir = fresh('shim-cold');
  const samples = [];
  const raw = [];
  for (let i = 0; i < n; i++) {
    const suffix = `${RUN}-cold-${i}`;
    const dataRoot = path.join(dir, `d${i}`);
    const mdir = path.join(dir, `m${i}`);
    ensureDir(mdir);
    await waitGone(suffix, 1000);
    const started = performance.now();
    const r = await runNode(SHIM, ['--pipe-suffix', suffix, '--data-root', dataRoot, '--metrics-dir', mdir, '--host-log', path.join(dataRoot, 'host.jsonl'), '--session', 'cold', '--seq', String(i + 1), '--budget-ms', '1000'], 15000);
    const wall = performance.now() - started;
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    const m = files.length ? JSON.parse(fs.readFileSync(path.join(mdir, files[0]), 'utf8')) : null;
    samples.push(wall);
    raw.push({ i, externalMs: Number(wall.toFixed(3)), outcome: m && m.outcome, durationMs: m && m.durationMs, attempts: m && m.attempts, spawnedPid: m && m.spawnedPid, phases: m && m.phases });
    log(`shim-cold ${i + 1}/${n}: ${wall.toFixed(1)} ms outcome=${m && m.outcome}`);
    if (m && m.spawnedPid) killPidSync(m.spawnedPid);
    await sleep(150);
  }
  results.sections.coldShim = { samples, ...summary(samples), raw };
  return results.sections.coldShim;
}

// ---------------------------------------------------------------- cold shim, host hardens its pipe ACL
async function coldShimHardened(n = 5) {
  const dir = fresh('shim-cold-acl');
  const helper = path.join(ROOT, 'out', 'bin', 'pipe-acl-helper.exe');
  const samples = [];
  const raw = [];
  for (let i = 0; i < n; i++) {
    const suffix = `${RUN}-coldacl-${i}`;
    const dataRoot = path.join(dir, `d${i}`);
    const mdir = path.join(dir, `m${i}`);
    ensureDir(mdir);
    await waitGone(suffix, 1000);
    const started = performance.now();
    const r = await runNode(SHIM, ['--pipe-suffix', suffix, '--data-root', dataRoot, '--metrics-dir', mdir, '--host-log', path.join(dataRoot, 'host.jsonl'), '--acl-helper', helper, '--session', 'cold-acl', '--seq', String(i + 1), '--budget-ms', '1000'], 15000);
    const wall = performance.now() - started;
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    const m = files.length ? JSON.parse(fs.readFileSync(path.join(mdir, files[0]), 'utf8')) : null;
    samples.push(wall);
    raw.push({ i, externalMs: Number(wall.toFixed(3)), outcome: m && m.outcome, durationMs: m && m.durationMs, attempts: m && m.attempts, spawnedPid: m && m.spawnedPid, phases: m && m.phases });
    log(`shim-cold-acl ${i + 1}/${n}: ${wall.toFixed(1)} ms outcome=${m && m.outcome}`);
    if (m && m.spawnedPid) killPidSync(m.spawnedPid);
    await sleep(150);
  }
  results.sections.coldShimHardened = { helper, samples, ...summary(samples), raw };
  return results.sections.coldShimHardened;
}

// ---------------------------------------------------------------- dispatch latency
async function dispatchLatency(n = 500) {
  const dir = fresh('dispatch');
  const dataRoot = path.join(dir, 'data');
  const suffix = `${RUN}-disp`;
  const hostLog = path.join(dir, 'host.jsonl');
  const outFile = path.join(dir, 'acks.jsonl');
  const child = spawnHost({ suffix, dataRoot, log: hostLog, idleMs: 600000 });
  await waitReady(suffix);
  const r = await runNode(CLIENT, ['--pipe-suffix', suffix, '--count', String(n), '--session', 'dispatch-session', '--seq', '1', '--out', outFile], 60000);
  const rows = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ingest = rows.map((x) => Number(x.ingestUs)).filter(Number.isFinite);
  const rtt = rows.map((x) => Number(x.rttMs)).filter(Number.isFinite);
  await stopHost(suffix, child);
  results.sections.dispatchLatency = {
    n: rows.length,
    clientExit: r.code,
    ingestUs: summary(ingest),
    rttMs: summary(rtt),
    note: 'ingestUs = host socket-data handler entry to dispatch() return, including journal append+fsync; rttMs = client write to ack receipt.',
  };
  return results.sections.dispatchLatency;
}

// ---------------------------------------------------------------- spool ordering
async function spoolSequential(n = 20) {
  const dir = fresh('spool-seq');
  const dataRoot = path.join(dir, 'data');
  const suffix = `${RUN}-sseq`;
  const spoolDir = path.join(dataRoot, 'spool');
  ensureDir(spoolDir);
  for (let i = 1; i <= n; i++) {
    const r = await runNode(SHIM, ['--pipe-suffix', suffix, '--data-root', dataRoot, '--no-spawn', '--session', 'spool-session', '--seq', String(i), '--kind', 'needs_input'], 15000);
    if (r.code !== 0) throw new Error(`shim ${i} exit ${r.code}`);
  }
  const files = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.jsonl')).sort();
  const hostLog = path.join(dir, 'host.jsonl');
  const child = spawnHost({ suffix, dataRoot, log: hostLog, idleMs: 600000, spoolPollMs: 0 });
  await waitReady(suffix);
  for (let i = 0; i < 40; i++) {
    const pong = await ping(suffix, 250);
    if (pong && pong.journalSeq >= n) break;
    await sleep(50);
  }
  const ingested = readLog(hostLog).filter((l) => l.event === 'spool_ingest');
  const seqOrder = ingested.map((l) => l.sequence);
  const expected = Array.from({ length: n }, (_, i) => i + 1);
  await stopHost(suffix, child);
  results.sections.spoolSequential = {
    n,
    spoolFiles: files,
    ingestOrder: seqOrder,
    preserved: JSON.stringify(seqOrder) === JSON.stringify(expected),
    remainingSpoolFiles: fs.existsSync(spoolDir) ? fs.readdirSync(spoolDir) : [],
  };
  return results.sections.spoolSequential;
}

async function spoolConcurrent(n = 20) {
  const dir = fresh('spool-conc');
  const dataRoot = path.join(dir, 'data');
  const suffix = `${RUN}-sconc`;
  const spoolDir = path.join(dataRoot, 'spool');
  ensureDir(spoolDir);
  const started = performance.now();
  await Promise.all(Array.from({ length: n }, (_, i) => runNode(SHIM, ['--pipe-suffix', suffix, '--data-root', dataRoot, '--no-spawn', '--session', 'spool-session', '--seq', String(i + 1), '--kind', 'needs_input'], 15000)));
  const spawnSpreadMs = performance.now() - started;
  const files = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.jsonl')).sort();
  const fileOrder = files.map((f) => Number(JSON.parse(fs.readFileSync(path.join(spoolDir, f), 'utf8').trim()).sequence));
  const hostLog = path.join(dir, 'host.jsonl');
  const child = spawnHost({ suffix, dataRoot, log: hostLog, idleMs: 600000, spoolPollMs: 0 });
  await waitReady(suffix);
  for (let i = 0; i < 40; i++) {
    const pong = await ping(suffix, 250);
    if (pong && pong.journalSeq >= n) break;
    await sleep(50);
  }
  const ingested = readLog(hostLog).filter((l) => l.event === 'spool_ingest');
  const ingestOrder = ingested.map((l) => l.sequence);
  let inversions = 0;
  for (let i = 0; i < ingestOrder.length; i++) {
    for (let j = i + 1; j < ingestOrder.length; j++) if (ingestOrder[i] > ingestOrder[j]) inversions++;
  }
  await stopHost(suffix, child);
  results.sections.spoolConcurrent = {
    n,
    spawnSpreadMs: Number(spawnSpreadMs.toFixed(3)),
    spoolFiles: files,
    fileOrder,
    ingestOrder,
    fileOrderEqualsIngestOrder: JSON.stringify(fileOrder) === JSON.stringify(ingestOrder),
    inversionsVsSequence: inversions,
    note: 'Concurrent shim invocations have no shared ordering authority; filenames carry ms timestamp+pid+random. File-name order is preserved; per-session sequence restores logical order.',
  };
  return results.sections.spoolConcurrent;
}

// ---------------------------------------------------------------- idle exit
async function idleExit() {
  const dir = fresh('idle');
  // A: single event, shortened idle window
  const suffixA = `${RUN}-idle-a`;
  const dataA = path.join(dir, 'a');
  const logA = path.join(dataA, 'host.jsonl');
  const childA = spawnHost({ suffix: suffixA, dataRoot: dataA, log: logA, idleMs: 3000, sessionLiveMs: 1000, spoolPollMs: 0 });
  await waitReady(suffixA);
  const sentAt = performance.now();
  await runNode(CLIENT, ['--pipe-suffix', suffixA, '--count', '1', '--session', 'idle-a', '--seq', '1', '--kind', 'turn_ended'], 15000);
  const exitA = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ code: 'timeout' }), 15000);
    childA.on('exit', (code) => { clearTimeout(t); resolve({ code, atMs: performance.now() }); });
  });
  const a = { exitCode: exitA.code, msFromEventToExit: exitA.atMs ? Number((exitA.atMs - sentAt).toFixed(3)) : null, log: readLog(logA).filter((l) => ['idle_start', 'idle_exit', 'shutdown', 'dispatch'].includes(l.event)) };

  // B: heartbeat for 6s, then idle
  const suffixB = `${RUN}-idle-b`;
  const dataB = path.join(dir, 'b');
  const logB = path.join(dataB, 'host.jsonl');
  const childB = spawnHost({ suffix: suffixB, dataRoot: dataB, log: logB, idleMs: 3000, sessionLiveMs: 1000, spoolPollMs: 0 });
  await waitReady(suffixB);
  let lastEventAt = performance.now();
  for (let i = 1; i <= 12; i++) {
    await runNode(CLIENT, ['--pipe-suffix', suffixB, '--count', '1', '--session', 'idle-b', '--seq', String(i), '--kind', 'progress'], 15000);
    lastEventAt = performance.now();
    await sleep(500);
  }
  const aliveBeforeStop = await ping(suffixB, 500);
  const exitB = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ code: 'timeout' }), 15000);
    childB.on('exit', (code) => { clearTimeout(t); resolve({ code, atMs: performance.now() }); });
  });
  const b = {
    exitCode: exitB.code,
    aliveAfter6s: !!(aliveBeforeStop && aliveBeforeStop.type === 'pong'),
    msFromLastEventToExit: exitB.atMs ? Number((exitB.atMs - lastEventAt).toFixed(3)) : null,
    log: readLog(logB).filter((l) => ['idle_start', 'idle_exit', 'shutdown'].includes(l.event)),
  };
  results.sections.idleExit = { shortenedTimerNote: 'idle-ms=3000, session-live-ms=1000 instead of 600000/600000', singleEvent: a, heartbeat: b };
  return results.sections.idleExit;
}

// ---------------------------------------------------------------- single instance
async function singleInstance() {
  const dir = fresh('single-instance');
  const dataRoot = path.join(dir, 'data');
  const suffix = `${RUN}-si`;
  const hostLog = path.join(dir, 'host.jsonl');
  const a = spawnHost({ suffix, dataRoot, log: hostLog, idleMs: 600000 });
  const ready = await waitReady(suffix);
  const b = spawn(process.execPath, [HOST, '--pipe-suffix', suffix, '--data-root', dataRoot, '--log', path.join(dir, 'host-b.jsonl'), '--idle-ms', '600000'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrB = '';
  b.stderr.setEncoding('utf8');
  b.stderr.on('data', (d) => { stderrB += d; });
  const exitB = await new Promise((resolve) => {
    const t = setTimeout(() => { kill(b.pid); resolve({ code: 'timeout' }); }, 15000);
    b.on('exit', (code) => { clearTimeout(t); resolve({ code }); });
  });
  const pongAfter = await ping(suffix, 500);
  const logB = readLog(path.join(dir, 'host-b.jsonl'));
  const pidMatchesA = pongAfter && pongAfter.pid === a.pid;
  await stopHost(suffix, a);
  results.sections.singleInstance = {
    firstHostPid: a.pid,
    readyMs: Number(ready.ms.toFixed(3)),
    secondExitCode: exitB.code,
    secondStderr: stderrB.trim(),
    secondLog: logB.filter((l) => ['journal_loaded', 'already_running', 'listening'].includes(l.event)),
    pingAfterSecondStart: pongAfter,
    oneLiveHostPidMatchesFirst: !!pidMatchesA,
  };
  return results.sections.singleInstance;
}

// ---------------------------------------------------------------- main
const only = process.argv[2];
const sections = [
  ['hostColdStart', hostColdStart],
  ['warmShim', warmShim],
  ['coldShim', coldShim],
  ['coldShimHardened', coldShimHardened],
  ['dispatchLatency', dispatchLatency],
  ['spoolSequential', spoolSequential],
  ['spoolConcurrent', spoolConcurrent],
  ['idleExit', idleExit],
  ['singleInstance', singleInstance],
];
for (const [name, fn] of sections) {
  if (only && only !== name) continue;
  const started = performance.now();
  log(`\n=== ${name} ===`);
  try {
    await fn();
    results.sections[name].wallMs = Number((performance.now() - started).toFixed(3));
  } catch (err) {
    results.sections[name] = { error: String((err && err.stack) || err) };
    log(`ERROR ${name}: ${err && err.message}`);
  }
  writeJson(path.join(OUT, 'measurements.json'), results);
}
results.finishedAt = new Date().toISOString();
writeJson(path.join(OUT, 'measurements.json'), results);
writeJson(path.join(OUT, `measurements-${RUN}.json`), results);
log('\nwrote ' + path.join(OUT, 'measurements.json'));

const s = results.sections;
const lines = [];
lines.push(`S2 process-model measurements ${results.startedAt} node=${results.node}`);
for (const [name, value] of Object.entries(s)) {
  if (!value || value.error) { lines.push(`${name}: ERROR ${value && value.error}`); continue; }
  if (name === 'hostColdStart') lines.push(`hostColdStart: n=${value.n} p50=${value.p50} p95=${value.p95} min=${value.min} max=${value.max}`);
  if (name === 'warmShim') lines.push(`warmShim: n=${value.n} p50=${value.p50} p95=${value.p95} p99=${value.p99} internalP50=${value.internalShimMs.p50} internalP95=${value.internalShimMs.p95} outcomes=${JSON.stringify(value.outcomes)}`);
  if (name === 'coldShim') lines.push(`coldShim: n=${value.n} p50=${value.p50} p95=${value.p95} max=${value.max}`);
  if (name === 'coldShimHardened') lines.push(`coldShimHardened: n=${value.n} p50=${value.p50} p95=${value.p95} max=${value.max}`);
  if (name === 'dispatchLatency') lines.push(`dispatchLatency: n=${value.n} ingestUs p50=${value.ingestUs.p50} p95=${value.ingestUs.p95} rttMs p50=${value.rttMs.p50} p95=${value.rttMs.p95}`);
  if (name === 'spoolSequential') lines.push(`spoolSequential: preserved=${value.preserved} files=${value.spoolFiles.length} ingestOrder=${JSON.stringify(value.ingestOrder)}`);
  if (name === 'spoolConcurrent') lines.push(`spoolConcurrent: fileOrderPreserved=${value.fileOrderEqualsIngestOrder} inversionsVsSequence=${value.inversionsVsSequence}`);
  if (name === 'idleExit') lines.push(`idleExit: single=${value.singleEvent.exitCode} ${value.singleEvent.msFromEventToExit}ms heartbeatAlive=${value.heartbeat.aliveAfter6s} heartbeatExit=${value.heartbeat.exitCode} ${value.heartbeat.msFromLastEventToExit}ms`);
  if (name === 'singleInstance') lines.push(`singleInstance: secondExit=${value.secondExitCode} oneLiveHost=${value.oneLiveHostPidMatchesFirst} pid=${value.firstHostPid}`);
}
const summaryText = lines.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'measurements-summary.txt'), summaryText);
log('\n' + summaryText);
