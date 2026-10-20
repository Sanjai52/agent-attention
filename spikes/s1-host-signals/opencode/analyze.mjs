// S1 throwaway analyzer. Prints an event inventory and the evidence needed by
// docs/spikes/phase-0-shards/s1-opencode.md. Read-only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../out/opencode");
const scenarios = [
  "permission-allow",
  "permission-deny",
  "plain-text",
  "negative-progress",
  "abort",
  "error-invalid-model",
  "subagent",
];

const totals = new Map();
let events = 0;
let permissionAsked = 0;
let permissionReplied = 0;
let idleEvents = 0;
let errorEvents = 0;
const ids = new Set();
const duplicates = new Set();
const seqs = new Map();

for (const scenario of scenarios) {
  const path = join(outDir, `${scenario}.jsonl`);
  const records = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const local = new Map();
  for (const record of records) {
    if (record.kind === "permission.pending.snapshot" && record.count > 0) {
      local.set("pending>0", (local.get("pending>0") ?? 0) + 1);
    }
    if (record.kind !== "event") continue;
    const event = record.event;
    events += 1;
    totals.set(event.type, (totals.get(event.type) ?? 0) + 1);
    if (event.type === "session.idle") idleEvents += 1;
    if (event.type === "session.error") errorEvents += 1;
    if (event.type === "permission.asked") permissionAsked += 1;
    if (event.type === "permission.replied") permissionReplied += 1;
    if (event.id) {
      if (ids.has(event.id)) duplicates.add(event.id);
      ids.add(event.id);
    }
    if (event.durable) {
      const aggregate = event.durable.aggregateID;
      const list = seqs.get(aggregate) ?? [];
      list.push(event.durable.seq);
      seqs.set(aggregate, list);
    }
  }
  const terminal = [...local.keys()].sort();
  const eventCount = records.filter((record) => record.kind === "event").length;
  console.log(
    `${scenario}: records=${records.length} events=${eventCount} pending>0=${local.get("pending>0") ?? 0}`,
  );
  console.log(
    `  terminal: ${[...new Set(records.filter((r) => r.kind === "event" && /^session\.execution\./.test(r.event.type)).map((r) => r.event.type))].join(", ")}`,
  );
  if (terminal.length) console.log(`  ${terminal.join(", ")}`);
}

console.log(`\ntotal events=${events} unique ids=${ids.size} duplicate ids=${duplicates.size}`);
console.log(`session.idle=${idleEvents} session.error=${errorEvents}`);
console.log(`permission.asked=${permissionAsked} permission.replied=${permissionReplied}`);
console.log("\nevent inventory:");
for (const [type, count] of [...totals.entries()].sort()) console.log(`  ${type} ${count}`);
console.log("\nsequence monotonicity:");
for (const [aggregate, list] of seqs) {
  const monotonic = list.every((value, index) => index === 0 || value > list[index - 1]);
  console.log(
    `  ${aggregate} count=${list.length} min=${Math.min(...list)} max=${Math.max(...list)} monotonic=${monotonic}`,
  );
}
