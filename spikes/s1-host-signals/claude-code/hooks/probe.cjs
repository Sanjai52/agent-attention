#!/usr/bin/env node
/**
 * Throwaway S1 probe. Reads one Claude Code hook payload from stdin and
 * appends it, plus timing, to <out>/<run-id>.jsonl.
 *
 * Env:
 *   PROBE_OUT_DIR                 capture directory (default spikes/.../out/claude-code)
 *   PROBE_RUN_ID                  capture file name stem (default "events")
 *   PROBE_SLEEP_MS                sleep before exit, to test whether the host waits
 *   PROBE_SLEEP_EVENTS            comma list; sleep only for these event names
 *   PROBE_PERMISSION_DECISION     "allow" | "deny" -> answer PermissionRequest
 *
 * Exit code is always 0. No stdout unless a permission decision is requested.
 */
const fs = require("node:fs");
const path = require("node:path");

const scriptStartWall = Date.now();
const scriptStartHr = process.hrtime.bigint();
const outDir =
  process.env.PROBE_OUT_DIR ||
  path.join(__dirname, "..", "..", "out", "claude-code");
const runId = process.env.PROBE_RUN_ID || "events";
const configuredSleepMs = Number(process.env.PROBE_SLEEP_MS || 0);
const sleepEvents = (process.env.PROBE_SLEEP_EVENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let sleepMs = configuredSleepMs;
const permissionDecision = (
  process.env.PROBE_PERMISSION_DECISION || ""
).toLowerCase();

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${runId}.jsonl`);

function msSinceStart() {
  return Number(process.hrtime.bigint() - scriptStartHr) / 1e6;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  const stdinReadMs = msSinceStart();
  let payload = null;
  let parseError = null;
  try {
    payload = raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    parseError = String(err && err.message ? err.message : err);
  }

  const eventName =
    (payload && payload.hook_event_name) ||
    process.env.PROBE_EVENT_HINT ||
    null;

  if (sleepEvents.length > 0 && !sleepEvents.includes(eventName)) {
    sleepMs = 0;
  }

  const record = {
    script_start_wall_ms: scriptStartWall,
    pid: process.pid,
    ppid: process.ppid,
    run_id: runId,
    event_name: eventName,
    tool_name: payload && payload.tool_name ? payload.tool_name : null,
    notification_type:
      payload && payload.notification_type ? payload.notification_type : null,
    session_id:
      payload && payload.session_id ? payload.session_id : null,
    permission_mode:
      payload && payload.permission_mode ? payload.permission_mode : null,
    sleep_ms: sleepMs,
    stdin_read_ms: Number(stdinReadMs.toFixed(3)),
    env: {
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || null,
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || null,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || null,
      PROBE_EVENT_HINT: process.env.PROBE_EVENT_HINT || null,
    },
    argv: process.argv.slice(2),
    parse_error: parseError,
    payload,
    raw,
  };

  // Log before sleeping so the capture records arrival even if the host kills us.
  const line = JSON.stringify(record) + "\n";
  const fd = fs.openSync(outFile, "a");
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }

  const logDoneMs = msSinceStart();

  if (sleepMs > 0) {
    const end = Date.now() + sleepMs;
    while (Date.now() < end) {
      // Busy wait: precise, and keeps this throwaway probe dependency-free.
    }
  }

  const exitWall = Date.now();
  const timing = {
    kind: "timing",
    run_id: runId,
    pid: process.pid,
    event_name: eventName,
    script_start_wall_ms: scriptStartWall,
    stdin_read_ms: Number(stdinReadMs.toFixed(3)),
    log_done_ms: Number(logDoneMs.toFixed(3)),
    sleep_ms: sleepMs,
    exit_wall_ms: exitWall,
    total_ms: Number(msSinceStart().toFixed(3)),
  };
  const fd2 = fs.openSync(outFile, "a");
  try {
    fs.writeSync(fd2, JSON.stringify(timing) + "\n");
  } finally {
    fs.closeSync(fd2);
  }

  if (eventName === "PermissionRequest" && permissionDecision) {
    const decision =
      permissionDecision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "S1 probe denial" };
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision,
        },
      })
    );
  }

  process.exit(0);
});
