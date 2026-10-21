import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pipePath, pipeShortName, paths } from './lib/paths.mjs';

const t0 = performance.now();
const { values: args } = parseArgs({
  options: {
    'pipe-suffix': { type: 'string', default: '' },
    'data-root': { type: 'string' },
    event: { type: 'string' },
    session: { type: 'string', default: 'shim-session' },
    kind: { type: 'string', default: 'needs_approval' },
    seq: { type: 'string', default: '1' },
    'event-id': { type: 'string' },
    'budget-ms': { type: 'string', default: '1000' },
    'connect-ms': { type: 'string', default: '250' },
    'retry-window-ms': { type: 'string', default: '700' },
    'no-spawn': { type: 'boolean', default: false },
    'metrics-dir': { type: 'string' },
    'host-log': { type: 'string' },
    'idle-ms': { type: 'string', default: '600000' },
    'acl-helper': { type: 'string' },
    'require-ack': { type: 'boolean', default: false },
  },
});

const budgetMs = Number(args['budget-ms']);
const pipe = pipePath(args['pipe-suffix']);
const p = paths(args['data-root']);
const phases = [];

const event = args.event
  ? JSON.parse(args.event)
  : {
      eventId: args['event-id'] || randomUUID(),
      sessionId: args.session,
      kind: args.kind,
      sequence: Number(args.seq),
      ts: Date.now(),
      source: 's2-shim',
    };

function phase(name, extra = {}) {
  phases.push({ name, atMs: Number((performance.now() - t0).toFixed(3)), ...extra });
}

function trySend(timeoutMs) {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.createConnection(pipe);
    let settled = false;
    let buf = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve({ ...result, ms: Number((performance.now() - started).toFixed(3)) });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      phase('connected');
      socket.write(JSON.stringify({ type: 'event', event }) + '\n');
    });
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        let ack = null;
        try { ack = JSON.parse(buf.slice(0, nl)); } catch {}
        if (ack && ack.type === 'ack') finish({ ok: true, ack });
      }
    });
    socket.on('error', (err) => finish({ ok: false, reason: (err && err.code) || (err && err.message) || 'error' }));
    socket.on('close', () => finish({ ok: false, reason: 'closed-without-ack' }));
  });
}

function spawnHost() {
  const hostScript = path.join(import.meta.dirname, 'host.mjs');
  const hostArgs = [hostScript, '--pipe-suffix', args['pipe-suffix'], '--idle-ms', args['idle-ms'], '--spool-poll-ms', '1000'];
  if (args['data-root']) hostArgs.push('--data-root', args['data-root']);
  if (args['host-log']) hostArgs.push('--log', args['host-log']);
  if (args['acl-helper']) hostArgs.push('--acl-helper', path.resolve(args['acl-helper']));
  const child = spawn(process.execPath, hostArgs, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return child;
}

function writeSpool(reason) {
  fs.mkdirSync(p.spoolDir, { recursive: true });
  const ts = String(Date.now()).padStart(13, '0');
  const rand = Math.random().toString(16).slice(2, 10);
  const base = `${ts}-${String(process.pid).padStart(6, '0')}-${rand}`;
  const tmp = path.join(p.spoolDir, `.${base}.tmp`);
  const final = path.join(p.spoolDir, `${base}.jsonl`);
  const record = { ...event, spooledAt: new Date().toISOString(), spoolReason: reason };
  fs.writeFileSync(tmp, JSON.stringify(record) + '\n', { flag: 'wx' });
  fs.renameSync(tmp, final);
  return final;
}

async function main() {
  phase('start');
  const deadline = t0 + budgetMs;

  const first = await trySend(Number(args['connect-ms']));
  phase('attempt1', { ok: first.ok, reason: first.reason, ms: first.ms });
  if (first.ok) return { outcome: 'pipe', ack: first.ack, spawned: false };

  let spawnedPid = null;
  if (!args['no-spawn']) {
    const child = spawnHost();
    spawnedPid = child.pid;
    phase('spawned', { pid: child.pid, windowsHide: true, detached: true, stdio: 'ignore' });
    const retryDeadline = Math.min(deadline - 120, performance.now() + Number(args['retry-window-ms']));
    let retry = null;
    let attempts = 0;
    while (performance.now() < retryDeadline) {
      attempts++;
      retry = await trySend(120);
      if (retry.ok) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    phase('retry', { ok: !!(retry && retry.ok), attempts, reason: retry && retry.reason, ms: retry && retry.ms });
    if (retry && retry.ok) return { outcome: 'spawned-pipe', ack: retry.ack, spawned: true, spawnedPid, attempts };
  }

  const spoolFile = writeSpool(first.reason);
  phase('spooled', { file: spoolFile });
  return { outcome: 'spool', spoolFile, spawned: !!spawnedPid, spawnedPid };
}

let result;
try {
  result = await main();
} catch (err) {
  result = { outcome: 'error', error: String((err && err.stack) || err) };
}

phase('exit', { outcome: result.outcome });
const metrics = {
  pid: process.pid,
  node: process.version,
  pipe,
  eventId: event.eventId,
  sessionId: event.sessionId,
  sequence: event.sequence,
  outcome: result.outcome,
  spawned: result.spawned || false,
  spawnedPid: result.spawnedPid || null,
  attempts: result.attempts ?? null,
  spoolFile: result.spoolFile || null,
  ack: result.ack || null,
  error: result.error || null,
  durationMs: Number((performance.now() - t0).toFixed(3)),
  phases,
};

if (args['metrics-dir']) {
  fs.mkdirSync(path.resolve(args['metrics-dir']), { recursive: true });
  const file = path.join(path.resolve(args['metrics-dir']), `${String(Date.now()).padStart(13, '0')}-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(metrics, null, 2));
}

if (args['require-ack'] && result.outcome !== 'pipe') {
  process.exitCode = 4;
}
process.exit(process.exitCode ?? 0);
