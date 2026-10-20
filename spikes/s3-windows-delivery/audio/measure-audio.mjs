// Throwaway spike harness: time fresh-process ("cold") and repeated ("warm")
// invocations of both audio routes, plus missing/corrupt-file failure paths.
// Usage: node measure-audio.mjs <wavPath> [runs]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [, , wavPath, runsArg = "5"] = process.argv;
const runs = Number(runsArg);
const ps1 = new URL("./play-soundplayer.ps1", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const mci = new URL("./play-mci.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function run(cmd, args) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const wallMs = Number((performance.now() - t0).toFixed(2));
  let parsed = null;
  try {
    parsed = JSON.parse((r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop());
  } catch {
    parsed = null;
  }
  return {
    wallMs,
    status: r.status,
    parsed,
    stderr: (r.stderr || "").trim().slice(0, 400),
  };
}

const results = { wavPath, runs, soundplayer: [], mci: [], failures: {}, environment: {} };

results.environment.node = process.version;
results.environment.platform = process.platform;
results.environment.arch = process.arch;

for (let i = 0; i < runs; i += 1) {
  results.soundplayer.push(
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ps1,
      "-Path",
      wavPath,
      "-Repeat",
      "3",
    ]),
  );
  results.mci.push(run(process.execPath, [mci, wavPath, "3"]));
}

const missing = `${wavPath}.missing.wav`;
results.failures.missingFile = {
  soundplayer: run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ps1,
    "-Path",
    missing,
  ]),
  mci: run(process.execPath, [mci, missing]),
};

const corrupt = wavPath.replace(/[^/\\]+$/, "corrupt.wav");
writeFileSync(corrupt, "this is not a wave file\n");
results.failures.corruptFile = {
  soundplayer: run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ps1,
    "-Path",
    corrupt,
  ]),
  mci: run(process.execPath, [mci, corrupt]),
};

console.log(JSON.stringify(results, null, 2));
