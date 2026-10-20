import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ROOT, OUT, CLIENT, ensureDir, kill, ping, readLog, runNode, spawnHost, waitGone, waitReady, writeJson } from './lib.mjs';

const dir = ensureDir(path.join(OUT, 'acl'));
const results = { at: new Date().toISOString(), node: process.version, checks: {} };

function acl(action, shortName) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'pipe-acl.ps1'), '-Action', action, '-PipeName', shortName], { encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function parseDacl(text) {
  const m = text.match(/DACL_SDDL=(.*)/);
  return m ? m[1].trim() : null;
}

const suffixBase = `s2-acl-${Date.now()}`;

// 1. Node's default DACL
{
  const suffix = `${suffixBase}-default`;
  const dataRoot = path.join(dir, 'default');
  const child = spawnHost({ suffix, dataRoot, log: path.join(dataRoot, 'host.jsonl'), idleMs: 600000 });
  await waitReady(suffix);
  const shortName = `agent-attention-${(process.env.USERNAME || 'unknown').toLowerCase()}-${suffix}`;
  const read = acl('read', shortName);
  results.checks.nodeDefaultDacl = { pipe: shortName, read, sddl: parseDacl(read.stdout) };
  console.log('nodeDefaultDacl', results.checks.nodeDefaultDacl.sddl);
  kill(child.pid);
  await waitGone(suffix, 3000);
}

// 2. Hardened DACL + current-user connect + hardening cost
{
  const suffix = `${suffixBase}-hard`;
  const dataRoot = path.join(dir, 'hardened');
  const logFile = path.join(dataRoot, 'host.jsonl');
  const child = spawnHost({ suffix, dataRoot, log: logFile, idleMs: 600000, hardenAcl: true });
  await waitReady(suffix);
  const shortName = `agent-attention-${(process.env.USERNAME || 'unknown').toLowerCase()}-${suffix}`;
  const read = acl('read', shortName);
  const connect = await runNode(CLIENT, ['--pipe-suffix', suffix, '--count', '1', '--session', 'acl', '--seq', '1'], 15000);
  const log = readLog(logFile).filter((l) => ['acl_harden', 'ready', 'listening'].includes(l.event));
  results.checks.hardenedDacl = { pipe: shortName, read, sddl: parseDacl(read.stdout), currentUserConnectExit: connect.code, hostLog: log };
  console.log('hardenedDacl', results.checks.hardenedDacl.sddl);
  kill(child.pid);
  await waitGone(suffix, 3000);
}

// 3. Enforcement control: explicit deny ACE for current user must block connect
{
  const suffix = `${suffixBase}-deny`;
  const dataRoot = path.join(dir, 'deny');
  const child = spawnHost({ suffix, dataRoot, log: path.join(dataRoot, 'host.jsonl'), idleMs: 600000 });
  await waitReady(suffix);
  const shortName = `agent-attention-${(process.env.USERNAME || 'unknown').toLowerCase()}-${suffix}`;
  const set = acl('set-deny-current-user', shortName);
  const readAfter = acl('read', shortName);
  const connect = await runNode(CLIENT, ['--pipe-suffix', suffix, '--count', '1', '--session', 'acl', '--seq', '1'], 15000);
  results.checks.denyAceEnforcement = { pipe: shortName, set, readAfter, connectExit: connect.code };
  console.log('denyAceEnforcement', JSON.stringify({ set: set.stdout.split('\n').slice(-2), connectExit: connect.code }));
  kill(child.pid);
  await waitGone(suffix, 3000);
}

// 4. Second low-privilege user: credentials unavailable, so not attempted
{
  const users = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-LocalUser | Select-Object -ExpandProperty Name'], { encoding: 'utf8', windowsHide: true });
  results.checks.secondUser = {
    localUsers: (users.stdout || '').trim().split(/\r?\n/).filter(Boolean),
    attempted: false,
    reason: 'A true cross-user connection test needs credentials for a second account (or admin to create one). This session is non-elevated (IsAdmin=False); no password for CodexSandboxOffline/CodexSandboxOnline is available. Documented as a limitation, not fabricated.',
  };
}

// 5. Cold-start cost of hardening (5 runs)
{
  const samples = [];
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const suffix = `${suffixBase}-cs-${i}`;
    const dataRoot = path.join(dir, `cs${i}`);
    const logFile = path.join(dataRoot, 'host.jsonl');
    const child = spawnHost({ suffix, dataRoot, log: logFile, idleMs: 600000, hardenAcl: true });
    const ready = await waitReady(suffix, 15000);
    const log = readLog(logFile);
    const aclLine = log.find((l) => l.event === 'acl_harden');
    samples.push(ready.ms);
    rows.push({ i, readyMs: Number(ready.ms.toFixed(3)), aclHardenMs: aclLine ? aclLine.ms : null, aclStatus: aclLine ? aclLine.status : null });
    kill(child.pid);
    await waitGone(suffix, 3000);
  }
  results.checks.hardenedColdStart = { samples, rows };
  console.log('hardenedColdStart', JSON.stringify(rows));
}

// 6. Compiled ACL helper: cost on the cold-start path
{
  const helper = path.join(ROOT, 'out', 'bin', 'pipe-acl-helper.exe');
  if (!fs.existsSync(helper)) {
    results.checks.helperColdStart = { error: 'helper not compiled', expected: helper };
  } else {
    const samples = [];
    const rows = [];
    let sddl = null;
    for (let i = 0; i < 5; i++) {
      const suffix = `${suffixBase}-hcs-${i}`;
      const dataRoot = path.join(dir, `hcs${i}`);
      const logFile = path.join(dataRoot, 'host.jsonl');
      const child = spawnHost({ suffix, dataRoot, log: logFile, idleMs: 600000, aclHelper: helper });
      const ready = await waitReady(suffix, 15000);
      const log = readLog(logFile);
      const aclLine = log.find((l) => l.event === 'acl_harden');
      samples.push(ready.ms);
      rows.push({ i, readyMs: Number(ready.ms.toFixed(3)), aclHardenMs: aclLine ? aclLine.ms : null, aclStatus: aclLine ? aclLine.status : null });
      if (i === 0) {
        const shortName = `agent-attention-${(process.env.USERNAME || 'unknown').toLowerCase()}-${suffix}`;
        sddl = parseDacl(acl('read', shortName).stdout);
      }
      kill(child.pid);
      await waitGone(suffix, 3000);
    }
    results.checks.helperColdStart = { samples, rows, sddl };
    console.log('helperColdStart', JSON.stringify(rows), sddl);
  }
}

writeJson(path.join(dir, 'acl.json'), results);
console.log('wrote ' + path.join(dir, 'acl.json'));