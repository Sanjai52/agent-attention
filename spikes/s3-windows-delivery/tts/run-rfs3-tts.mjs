// Throwaway RF-S3 TTS child: read UTF-8 text bytes, pipe them to speak.ps1 on
// stdin, and write the result to -OutFile. Launched by WMI so no terminal is
// attached; text is never interpolated into the command line.
// Usage: node run-rfs3-tts.mjs <textFile> <outFile> [mode]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [, , textFile, outFile, mode = "speak"] = process.argv;
const toWinPath = (url) => decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const speakPs1 = toWinPath(new URL("./speak.ps1", import.meta.url));
const fakehome = toWinPath(new URL("../out/fakehome/", import.meta.url));
mkdirSync(fakehome, { recursive: true });
writeFileSync(`${fakehome}/sentinel.txt`, "sentinel");
const textBytes = readFileSync(textFile);

const child = spawn(
  "powershell.exe",
  ["-NoProfile", "-NoLogo", "-ExecutionPolicy", "Bypass", "-File", speakPs1, "-Mode", mode],
  {
    windowsHide: true,
    cwd: fakehome,
    env: { ...process.env, USERPROFILE: fakehome, HOME: fakehome },
  },
);
let stdout = "";
let stderr = "";
child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
child.stdin.end(textBytes);
child.on("close", (code) => {
  const info = {
    pid: process.pid,
    ppid: process.ppid,
    mode,
    textFile,
    bytesIn: textBytes.length,
    exitCode: code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    canaryPwnedExists: existsSync(`${fakehome}/canary-pwned.txt`),
    sentinelExists: existsSync(`${fakehome}/sentinel.txt`),
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(outFile, JSON.stringify(info, null, 2));
});
