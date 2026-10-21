/**
 * Manual Phase 5 smoke harness for Claude Code. It does not modify global
 * settings and is not a CI test. Set CLAUDE_CODE_LIVE_CAPTURE to a sanitized
 * JSON capture after a temporary interactive hook run, then execute:
 *
 *   npx tsx tests/live-smoke/claude-code.smoke.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const version = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
console.log(`host=claude-code version=${version}`);

const capturePath = process.env.CLAUDE_CODE_LIVE_CAPTURE;
if (capturePath === undefined || capturePath.trim() === "") {
  console.log("capture=BLOCKED (set CLAUDE_CODE_LIVE_CAPTURE after a sanitized interactive hook run)");
  process.exitCode = 2;
} else if (!existsSync(capturePath)) {
  throw new Error(`Capture file does not exist: ${capturePath}`);
} else {
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
    host?: string;
    version?: string;
    events?: Array<{ hookEventName?: string; sessionId?: string }>;
  };
  if (capture.host !== "claude-code" || capture.version === undefined || !Array.isArray(capture.events)) {
    throw new Error("Capture must contain host=claude-code, version, and events[]");
  }
  const names = new Set(capture.events.map((event) => event.hookEventName));
  for (const required of ["SessionStart", "Stop", "SessionEnd"]) {
    if (!names.has(required)) throw new Error(`Missing required live hook: ${required}`);
  }
  console.log(`capture=PASS events=${capture.events.length} hooks=${[...names].join(",")}`);
}
