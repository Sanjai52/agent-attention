// Throwaway spike launcher for RF-S3: start a delivery command detached, write
// its stdout/stderr to files, then exit immediately. The invoking shell is gone
// when the child finishes; a later shell reads the output. This models a
// background host with no terminal attached.
// Usage: node run-detached.mjs <outPrefix> <command> [args...]
import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";

const [, , outPrefix, cmd, ...args] = process.argv;
if (!outPrefix || !cmd) {
  console.error("usage: node run-detached.mjs <outPrefix> <command> [args...]");
  process.exit(2);
}

const stdoutFd = openSync(`${outPrefix}.stdout.log`, "w");
const stderrFd = openSync(`${outPrefix}.stderr.log`, "w");
const child = spawn(cmd, args, {
  detached: true,
  windowsHide: true,
  stdio: ["ignore", stdoutFd, stderrFd],
});
const meta = {
  launcherPid: process.pid,
  childPid: child.pid,
  command: [cmd, ...args],
  launchedAt: new Date().toISOString(),
};
writeFileSync(`${outPrefix}.meta.json`, JSON.stringify(meta, null, 2));
child.unref();
console.log(JSON.stringify(meta));
// Exit immediately; the detached child keeps running after this process dies.
process.exit(0);
