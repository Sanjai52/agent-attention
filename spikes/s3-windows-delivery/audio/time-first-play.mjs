// Throwaway spike harness: true wall-clock spawn -> first Play() accepted, and
// total process lifetime. "Cold" = first run in this session; "warm" = later
// runs. Actual audible onset is later by the device buffer (not measured here).
// Usage: node time-first-play.mjs <wavPath> [runs]
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const [, , wavPath, runsArg = "6"] = process.argv;
const runs = Number(runsArg);
const toWinPath = (url) => decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const ps1 = toWinPath(new URL("./play-soundplayer.ps1", import.meta.url));
const mci = toWinPath(new URL("./play-mci.mjs", import.meta.url));

function once(cmd, args) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, { windowsHide: true });
    let firstMs = null;
    let buf = "";
    let lastJson = null;
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("FIRST_PLAY_MS=")) {
          if (firstMs === null) firstMs = Number((performance.now() - t0).toFixed(2));
        } else if (line.startsWith("{")) {
          try {
            lastJson = JSON.parse(line);
          } catch {
            /* ignore */
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      resolve({
        spawnToFirstPlayMs: firstMs,
        lifetimeMs: Number((performance.now() - t0).toFixed(2)),
        exitCode: code,
        steadyStatePlayMs: lastJson?.calls?.slice(1).map((c) => c.playCallMs) ?? null,
        error: lastJson?.error ?? null,
      });
    });
  });
}

const out = { wavPath, soundplayer: [], mci: [] };
for (let i = 0; i < runs; i += 1) {
  out.soundplayer.push(
    await once("powershell.exe", [
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
  out.mci.push(await once(process.execPath, [mci, wavPath, "3"]));
}
console.log(JSON.stringify(out, null, 2));
