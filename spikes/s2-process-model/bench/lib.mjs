import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const OUT = path.join(ROOT, 'out', 'bench');
export const HOST = path.join(ROOT, 'host.mjs');
export const SHIM = path.join(ROOT, 'shim.mjs');
export const CLIENT = path.join(ROOT, 'client.mjs');

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(3));
}

export function stats(values) {
  return {
    n: values.length,
    min: values.length ? Number(Math.min(...values).toFixed(3)) : null,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Number(Math.max(...values).toFixed(3)) : null,
    mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null,
  };
}

export function pipeFor(suffix) {
  return `\\\\.\\pipe\\agent-attention-${(process.env.USERNAME || 'unknown').toLowerCase()}-${suffix}`;
}

export function ping(suffix, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipeFor(suffix));
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify({ type: 'ping' }) + '\n'));
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        try { done(JSON.parse(buf.slice(0, nl))); } catch { done(null); }
      }
    });
    socket.on('error', () => { clearTimeout(timer); done(null); });
    socket.on('close', () => { clearTimeout(timer); done(null); });
  });
}

export function spawnHost({ suffix, dataRoot, log, idleMs = 600000, sessionLiveMs = 600000, hardenAcl = false, aclHelper = null, spoolPollMs = 1000, exitAfterMs = 0, stdio = 'ignore' }) {
  const args = [HOST, '--pipe-suffix', suffix, '--data-root', dataRoot, '--log', log, '--idle-ms', String(idleMs), '--session-live-ms', String(sessionLiveMs), '--spool-poll-ms', String(spoolPollMs)];
  if (hardenAcl) args.push('--harden-acl');
  if (aclHelper) args.push('--acl-helper', aclHelper);
  if (exitAfterMs) args.push('--exit-after-ms', String(exitAfterMs));
  return spawn(process.execPath, args, { windowsHide: true, stdio, detached: true });
}

export async function waitReady(suffix, timeoutMs = 10000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const pong = await ping(suffix, 250);
    if (pong && pong.type === 'pong') return { ms: performance.now() - started, pong };
    await sleep(15);
  }
  throw new Error(`host did not become ready on ${suffix}`);
}

export function kill(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, encoding: 'utf8' });
}

export function killPidSync(pid) {
  const r = spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

export async function waitGone(suffix, timeoutMs = 5000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const pong = await ping(suffix, 150);
    if (!pong) return true;
    await sleep(25);
  }
  return false;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runNode(script, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, [script, ...args], { windowsHide: true, stdio: 'ignore' });
    let timer = setTimeout(() => { kill(child.pid); }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Number((performance.now() - started).toFixed(3)), pid: child.pid });
    });
  });
}

export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { event: 'unparsable', line }; }
  });
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
