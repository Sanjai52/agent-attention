#!/usr/bin/env node
// S1 Codex probe hook — throwaway evidence collector, do not promote.
// Reads the documented hook JSON from stdin and appends one JSONL record per
// invocation. Writes nothing to stdout so the host's default behavior stands.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "out", "codex");
mkdirSync(outDir, { recursive: true });

const started = Date.now();
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");

let payload = null;
let parseError = null;
try {
  payload = JSON.parse(raw);
} catch (error) {
  parseError = String(error);
}

const ended = Date.now();
const record = {
  probe: "s1-codex-hook",
  received_at: new Date(started).toISOString(),
  finished_at: new Date(ended).toISOString(),
  // Wall-clock lifetime of this hook process, including Node start-up.
  hook_process_ms: ended - started,
  run_label: process.env.S1_RUN_LABEL ?? null,
  hook_event_name: payload?.hook_event_name ?? null,
  session_id: payload?.session_id ?? null,
  turn_id: payload?.turn_id ?? null,
  raw_stdin_bytes: Buffer.byteLength(raw),
  payload,
  parse_error: parseError,
};

const target = join(
  outDir,
  `${(process.env.S1_RUN_LABEL ?? "unlabelled").replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`,
);
appendFileSync(target, JSON.stringify(record) + "\n", "utf8");

// Deliberately silent: no stdout, exit 0. The probe never decides a permission,
// blocks a turn, or changes host behavior.
