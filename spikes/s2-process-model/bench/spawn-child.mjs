import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOST } from './lib.mjs';

// Run this from a process that owns a visible console. It spawns the host the
// same way shim.mjs does and reports the host pid so the orchestrator can probe
// whether that host owns a visible console window.
const mode = process.argv[2] ?? 'detached';
const pidFile = process.argv[3];
const logFile = process.argv[4];
const dataRoot = process.argv[5];
const suffix = process.argv[6];

// mode:
//   detached        -> detached:true,  windowsHide:true   (the shim's real flags)
//   hidden-nodetach -> detached:false, windowsHide:true   (CREATE_NO_WINDOW control)
//   inherited       -> detached:false, windowsHide:false  (visible-console control)
const detached = mode === 'detached';
const windowsHide = mode !== 'inherited';

const child = spawn(process.execPath, [HOST, '--pipe-suffix', suffix, '--data-root', dataRoot, '--log', logFile, '--idle-ms', '600000', '--exit-after-ms', '7000'], {
  detached,
  windowsHide,
  stdio: 'ignore',
});
child.unref();
fs.writeFileSync(pidFile, JSON.stringify({ hostPid: child.pid, parentPid: process.pid, mode, detached, windowsHide }));
process.stdout.write(`spawned ${child.pid} mode=${mode} detached=${detached} windowsHide=${windowsHide}\n`);
setTimeout(() => process.exit(0), 8000);
