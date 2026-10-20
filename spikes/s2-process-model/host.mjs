import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pipePath, pipeShortName, paths } from './lib/paths.mjs';
import { Journal } from './lib/journal.mjs';

const { values: args } = parseArgs({
  options: {
    'pipe-suffix': { type: 'string', default: '' },
    'data-root': { type: 'string' },
    'idle-ms': { type: 'string', default: '600000' },
    'session-live-ms': { type: 'string', default: '600000' },
    'spool-poll-ms': { type: 'string', default: '1000' },
    'harden-acl': { type: 'boolean', default: false },
    'acl-helper': { type: 'string' },
    log: { type: 'string' },
    'crash-writer': { type: 'boolean', default: false },
    'verify-only': { type: 'boolean', default: false },
    'exit-after-ms': { type: 'string', default: '0' },
  },
});

const idleMs = Number(args['idle-ms']);
const sessionLiveMs = Number(args['session-live-ms']);
const spoolPollMs = Number(args['spool-poll-ms']);
const p = paths(args['data-root']);
const shortName = pipeShortName(args['pipe-suffix']);
const pipe = pipePath(args['pipe-suffix']);
const logPath = args.log ? path.resolve(args.log) : path.join(p.logsDir, `host-${process.pid}.jsonl`);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logFd = fs.openSync(logPath, 'a');
const tProcess = performance.now();

function log(obj) {
  const rec = { ts: new Date().toISOString(), pid: process.pid, monoMs: Number((performance.now() - tProcess).toFixed(3)), ...obj };
  fs.writeSync(logFd, JSON.stringify(rec) + '\n');
}

const journal = new Journal(p.journal).open().load();
log({
  event: 'journal_loaded',
  file: p.journal,
  records: journal.records,
  lastSeq: journal.seq,
  truncatedBytes: journal.truncatedBytes,
  dedupeIds: journal.ids.size,
});

if (args['verify-only']) {
  const result = {
    file: p.journal,
    records: journal.records,
    lastSeq: journal.seq,
    truncatedBytes: journal.truncatedBytes,
    contiguous: journal.seq === journal.records,
    dedupeIds: journal.ids.size,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  journal.close();
  process.exit(0);
}

if (args['crash-writer']) {
  log({ event: 'crash_writer_start', file: p.journal });
  let i = 0;
  const padding = 'x'.repeat(16 * 1024);
  for (;;) {
    i++;
    const event = {
      eventId: `crash-${process.pid}-${i}`,
      sessionId: 'crash-session',
      kind: 'progress',
      sequence: i,
      ts: Date.now(),
      padding,
    };
    const seq = journal.append(event);
    fs.writeSync(1, `WROTE ${seq}\n`);
  }
}

const sessions = new Map();
let activeSockets = 0;
let dispatched = 0;
let lastActivity = Date.now();
let drySince = null;
let shuttingDown = false;
let server = null;

function dispatch(event, source) {
  dispatched++;
  return performance.now();
}

function ingestSpool(reason) {
  if (!fs.existsSync(p.spoolDir)) return 0;
  const files = fs.readdirSync(p.spoolDir).filter((f) => f.endsWith('.jsonl')).sort();
  let ingested = 0;
  for (const file of files) {
    const full = path.join(p.spoolDir, file);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (err) {
      log({ event: 'spool_read_error', file, error: String(err && err.message) });
      continue;
    }
    const lines = text.split('\n').filter(Boolean);
    let ok = true;
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        log({ event: 'spool_parse_error', file });
        ok = false;
        break;
      }
      if (journal.ids.has(event.eventId)) {
        log({ event: 'spool_duplicate', file, eventId: event.eventId, reason });
        continue;
      }
      const seq = journal.append(event);
      const tIngest = performance.now();
      const tDispatch = dispatch(event, 'spool');
      lastActivity = Date.now();
      sessions.set(event.sessionId, { lastSeen: Date.now(), sequence: event.sequence });
      drySince = null;
      ingested++;
      log({
        event: 'spool_ingest',
        source: reason,
        file,
        seq,
        eventId: event.eventId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        ingestUs: Number(((tDispatch - tIngest) * 1000).toFixed(1)),
      });
      if (journal.records <= 500) {
        log({ event: 'dispatch', source: 'spool', seq, eventId: event.eventId, sessionId: event.sessionId, sequence: event.sequence, kind: event.kind });
      }
    }
    if (ok) {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        log({ event: 'spool_unlink_error', file, error: String(err && err.message) });
      }
    }
  }
  if (files.length > 0) log({ event: 'spool_scan', reason, files: files.length, ingested });
  return ingested;
}

const startupSpool = ingestSpool('startup');

server = net.createServer((socket) => {
  activeSockets++;
  let buf = '';
  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const t0 = performance.now();
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        socket.write(JSON.stringify({ type: 'error', error: 'invalid_json' }) + '\n');
        continue;
      }
      if (msg.type === 'ping') {
        socket.write(JSON.stringify({ type: 'pong', pid: process.pid, uptimeMs: Math.round(performance.now() - tProcess), sessions: sessions.size, journalSeq: journal.seq, dispatched }) + '\n');
        continue;
      }
      if (msg.type === 'shutdown') {
        socket.write(JSON.stringify({ type: 'bye' }) + '\n');
        socket.end();
        shutdown('shutdown-message');
        continue;
      }
      if (msg.type !== 'event' || !msg.event || typeof msg.event !== 'object') {
        socket.write(JSON.stringify({ type: 'error', error: 'invalid_message' }) + '\n');
        continue;
      }
      const event = msg.event;
      if (!event.eventId || !event.sessionId || !event.kind) {
        socket.write(JSON.stringify({ type: 'error', error: 'invalid_event' }) + '\n');
        continue;
      }
      if (journal.ids.has(event.eventId)) {
        log({ event: 'duplicate', eventId: event.eventId, sessionId: event.sessionId });
        socket.write(JSON.stringify({ type: 'ack', eventId: event.eventId, duplicate: true, seq: null, ingestUs: 0 }) + '\n');
        continue;
      }
      const seq = journal.append(event);
      const tDispatch = dispatch(event, 'pipe');
      lastActivity = Date.now();
      sessions.set(event.sessionId, { lastSeen: Date.now(), sequence: event.sequence });
      drySince = null;
      const ingestUs = (tDispatch - t0) * 1000;
      log({
        event: 'dispatch',
        source: 'pipe',
        seq,
        eventId: event.eventId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        kind: event.kind,
        ingestUs: Number(ingestUs.toFixed(1)),
      });
      socket.write(JSON.stringify({ type: 'ack', eventId: event.eventId, duplicate: false, seq, ingestUs: Number(ingestUs.toFixed(1)) }) + '\n');
    }
  });

  socket.on('error', (err) => log({ event: 'socket_error', error: String(err && err.message) }));
  socket.on('close', () => { activeSockets--; });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    log({ event: 'already_running', pipe });
    process.stderr.write(`agent-attention host: already running on ${pipe}\n`);
    process.exit(3);
  }
  log({ event: 'listen_error', error: String(err && err.message) });
  process.stderr.write(`agent-attention host: listen failed: ${err && err.message}\n`);
  process.exit(1);
});

server.listen(pipe, () => {
  log({ event: 'listening', pipe, startupSpool, journalRecords: journal.records });
  if (args['acl-helper']) {
    const t = performance.now();
    const r = spawnSync(path.resolve(args['acl-helper']), ['set-user-only', shortName], { encoding: 'utf8', windowsHide: true });
    log({ event: 'acl_harden', tool: 'exe', status: r.status, ms: Number((performance.now() - t).toFixed(1)), stdout: (r.stdout || '').trim().split('\n'), stderr: (r.stderr || '').trim() });
  } else if (args['harden-acl']) {
    const t = performance.now();
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'scripts', 'pipe-acl.ps1'), '-Action', 'set-user-only', '-PipeName', shortName], { encoding: 'utf8', windowsHide: true });
    log({
      event: 'acl_harden',
      tool: 'powershell',
      shortName,
      status: r.status,
      ms: Number((performance.now() - t).toFixed(1)),
      stdout: (r.stdout || '').trim().split('\n'),
      stderr: (r.stderr || '').trim(),
    });
  }
  log({ event: 'ready', pipe, hardenAcl: args['harden-acl'], aclHelper: args['acl-helper'] || null });
});

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log({ event: 'shutdown', reason, journalSeq: journal.seq, dispatched });
  clearInterval(idleTimer);
  clearInterval(spoolTimer);
  try { server && server.close(); } catch {}
  journal.close();
  fs.closeSync(logFd);
  process.exit(0);
}

const idleTimer = setInterval(() => {
  if (shuttingDown) return;
  const now = Date.now();
  const live = [...sessions.values()].some((s) => now - s.lastSeen <= sessionLiveMs);
  if (activeSockets === 0 && !live) {
    if (drySince === null) {
      drySince = now;
      log({ event: 'idle_start', idleMs, sessionLiveMs, sessions: sessions.size });
    }
    if (now - drySince >= idleMs) {
      log({ event: 'idle_exit', idleForMs: now - drySince, idleMs, sessions: sessions.size });
      shutdown('idle');
    }
  } else {
    if (drySince !== null) log({ event: 'idle_reset', reason: live ? 'live-session' : 'active-socket' });
    drySince = null;
  }
}, 100);
idleTimer.unref();

const spoolTimer = spoolPollMs > 0
  ? setInterval(() => { if (!shuttingDown) ingestSpool('poll'); }, spoolPollMs)
  : null;
if (spoolTimer) spoolTimer.unref();

if (Number(args['exit-after-ms']) > 0) {
  setTimeout(() => shutdown('exit-after-ms'), Number(args['exit-after-ms'])).unref();
}

process.on('SIGTERM', () => shutdown('sigterm'));
process.on('SIGINT', () => shutdown('sigint'));

log({ event: 'boot', pipe, pipeShortName: shortName, idleMs, sessionLiveMs, spoolPollMs, startupSpool, journal: p.journal, node: process.version });
