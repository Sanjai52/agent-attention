/**
 * Manual Phase 3 smoke report for a real OpenCode capture.
 *
 * Run after `spikes/s1-host-signals/opencode/run-capture.mjs <scenario>`:
 *
 *   npx tsx tests/live-smoke/opencode.smoke.ts
 *
 * This script reads only the capture produced by the private OpenCode server;
 * it does not modify global OpenCode configuration. The adapter fixture tests
 * remain the deterministic CI gate; this script records host observations.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("spikes/s1-host-signals/out/opencode");
const runPath = resolve(root, "run.json");

if (!existsSync(runPath)) {
  throw new Error("No live capture found. Run run-capture.mjs first.");
}

const run = JSON.parse(readFileSync(runPath, "utf8")) as {
  host: string;
  version: string;
  node: string;
  scenarios: Array<{
    id: string;
    ok: boolean;
    session?: string;
    terminalEvent?: { type?: string };
    logPath?: string;
  }>;
};

console.log(`host=${run.host} version=${run.version} node=${run.node}`);
for (const scenario of run.scenarios) {
  console.log(
    `${scenario.id}: ${scenario.ok ? "PASS" : "FAIL"} ` +
      `session=${scenario.session ?? "unknown"} ` +
      `terminal=${scenario.terminalEvent?.type ?? "none"}`,
  );
}

if (run.host !== "opencode" || !run.version.includes("2.0.32")) {
  throw new Error("Live capture is not from the declared OpenCode v2.0.32 host.");
}
if (run.scenarios.length === 0 || run.scenarios.some((scenario) => !scenario.ok)) {
  throw new Error("At least one live smoke scenario failed.");
}
