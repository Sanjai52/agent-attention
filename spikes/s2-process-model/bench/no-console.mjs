import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, OUT, HOST, SHIM, ensureDir, killPidSync, writeJson } from './lib.mjs';

const dir = ensureDir(path.join(OUT, 'no-console'));
const suffixBase = `s2-nc-${Date.now()}`;

function windowCheck(pid) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'window-check.ps1'), '-TargetPid', String(pid)], { encoding: 'utf8', windowsHide: true });
  let parsed = null;
  try { parsed = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
  return { status: r.status, raw: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), parsed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchWithConsole(mode) {
  const pidFile = path.join(dir, `${mode}-console.json`);
  if (fs.existsSync(pidFile)) fs.rmSync(pidFile);
  const hostLog = path.join(dir, `${mode}.host.jsonl`);
  const dataRoot = path.join(dir, `${mode}-data`);
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'console-parent-alloc.ps1'), '-Mode', mode, '-PidFile', pidFile, '-HostLog', hostLog, '-DataRoot', dataRoot, '-Suffix', `${suffixBase}-${mode}`], { windowsHide: true, stdio: 'ignore' });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !fs.existsSync(pidFile)) await sleep(50);
  if (!fs.existsSync(pidFile)) throw new Error(`launcher did not report pid for ${mode}`);
  const info = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  await sleep(1500);
  const scan = windowCheck(info.hostPid);
  killPidSync(info.hostPid);
  ps.kill();
  return { ...info, scan };
}

const results = { at: new Date().toISOString(), node: process.version, checks: {} };

// A. Parent owns a real, visible console (AllocConsole in the launcher).
//    detached is the shim's real flag; the other two are controls proving the probe
//    can see a visible console and that windowsHide suppresses one.
for (const mode of ['detached', 'hidden-nodetach', 'inherited']) {
  const r = await launchWithConsole(mode);
  results.checks[mode] = r;
  console.log(mode, JSON.stringify(r.scan.parsed));
}

// B. The real shim path, spawned by the shim itself.
{
  const suffix = `${suffixBase}-via-shim`;
  const dataRoot = path.join(dir, 'via-shim-data');
  const mdir = ensureDir(path.join(dir, 'via-shim-metrics'));
  const shim = spawnSync(process.execPath, [SHIM, '--pipe-suffix', suffix, '--data-root', dataRoot, '--metrics-dir', mdir, '--host-log', path.join(dir, 'via-shim.host.jsonl'), '--budget-ms', '1500'], { encoding: 'utf8', windowsHide: true });
  const mfile = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'))[0];
  const metrics = mfile ? JSON.parse(fs.readFileSync(path.join(mdir, mfile), 'utf8')) : null;
  const hostPid = metrics && metrics.spawnedPid;
  let scan = null;
  if (hostPid) {
    await sleep(800);
    scan = windowCheck(hostPid);
  }
  results.checks.viaShim = { shimExit: shim.status, shimStderr: (shim.stderr || '').trim(), metrics: metrics && { outcome: metrics.outcome, spawned: metrics.spawned, spawnedPid: metrics.spawnedPid, durationMs: metrics.durationMs, phases: metrics.phases }, scan };
  console.log('viaShim', JSON.stringify(scan && scan.parsed));
  if (hostPid) killPidSync(hostPid);
}

writeJson(path.join(dir, 'no-console.json'), results);
console.log('wrote ' + path.join(dir, 'no-console.json'));
