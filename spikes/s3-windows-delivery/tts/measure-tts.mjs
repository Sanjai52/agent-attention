// Throwaway spike harness for System.Speech TTS.
// Measures spawn -> first rendered word (cold fresh processes and warm
// in-process repeats), cancellation, hostile stdin, missing voice, and the
// no-endpoint (SetOutputToNull) path.
// Usage: node measure-tts.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

const toWinPath = (url) => decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const speakPs1 = toWinPath(new URL("./speak.ps1", import.meta.url));
const outDir = toWinPath(new URL("../out/", import.meta.url));
mkdirSync(outDir, { recursive: true });

function runSpeak({ text, args = [], cwd, env }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NoLogo", "-ExecutionPolicy", "Bypass", "-File", speakPs1, ...args],
      { windowsHide: true, cwd, env: { ...process.env, ...env } },
    );
    let firstAudioMs = null;
    let buf = "";
    let lastJson = null;
    child.stdin.end(Buffer.from(text, "utf8"));
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("FIRST_AUDIO_MS=")) {
          if (firstAudioMs === null) firstAudioMs = Number((performance.now() - t0).toFixed(2));
        } else if (line.startsWith("{")) {
          try {
            lastJson = JSON.parse(line);
          } catch {
            /* ignore */
          }
        }
      }
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({
        spawnToFirstAudioMs: firstAudioMs,
        wallMs: Number((performance.now() - t0).toFixed(2)),
        exitCode: code,
        parsed: lastJson,
        stderr: stderr.trim().slice(0, 600),
      });
    });
  });
}

const results = { environment: { node: process.version, platform: process.platform } };
const shortText = "Agent needs your approval.";

results.coldAndWarmProcesses = [];
for (let i = 0; i < 5; i += 1) {
  results.coldAndWarmProcesses.push(
    await runSpeak({ text: shortText, args: ["-Rate", "0", "-Volume", "80"] }),
  );
}

results.warmInProcess = await runSpeak({
  text: shortText,
  args: ["-Rate", "0", "-Volume", "80", "-Repeat", "3"],
});

results.rateVolume = {
  slowQuiet: await runSpeak({ text: shortText, args: ["-Rate", "-5", "-Volume", "20"] }),
  fastLoud: await runSpeak({ text: shortText, args: ["-Rate", "5", "-Volume", "100"] }),
};

// Hostile string: exact bytes, canary cwd, canary HOME.
const hostileDir = `${outDir}/fakehome`;
mkdirSync(hostileDir, { recursive: true });
writeFileSync(`${hostileDir}/sentinel.txt`, "sentinel");
const hostileText = readFileSync(`${outDir}/hostile-tts.txt`);
const hostileSha = createHash("sha256").update(hostileText).digest("hex");
results.hostile = await runSpeak({
  text: hostileText.toString("utf8"),
  args: ["-Rate", "0", "-Volume", "60"],
  cwd: hostileDir,
  env: { USERPROFILE: hostileDir, HOME: hostileDir },
});
results.hostile.expectedSha256 = hostileSha;
results.hostile.canaryPwnedExists = existsSync(`${hostileDir}/canary-pwned.txt`);
results.hostile.sentinelExistsAfter = existsSync(`${hostileDir}/sentinel.txt`);

results.missingVoice = await runSpeak({
  text: shortText,
  args: ["-Voice", "Microsoft No Such Voice"],
});
results.nullOutput = await runSpeak({ text: shortText, args: ["-NullOutput"] });

const longText = Array.from(
  { length: 12 },
  () => "This is a long utterance used to test cancellation behavior. ",
).join("");
results.cancel = await runSpeak({
  text: longText,
  args: ["-Mode", "cancel", "-CancelAfterMs", "800"],
});
results.queueCancel = await runSpeak({
  text: longText,
  args: ["-Mode", "queue", "-CancelAfterMs", "800"],
});

console.log(JSON.stringify(results, null, 2));
