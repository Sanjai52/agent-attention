/**
 * Test helper: hold the host pipe in a child process that the parent kills.
 * This exercises OS-level pipe release and restart reconciliation; SQLite
 * crash recovery belongs to the storage workstream.
 */

import { writeFileSync } from "node:fs";

import { defaultConfig } from "../../packages/contract/src/index";
import { createPipeServer } from "../../packages/host/src/pipe-server";
import type { ProviderSet } from "../../packages/host/src/connection";
import type { SessionRecord } from "../../packages/core/src/state/session";
import { MemoryPipelineStore } from "./memory-store";

const [pipeName, sessionsFile] = process.argv.slice(2);

if (pipeName === undefined || sessionsFile === undefined) {
  process.exit(2);
}

const providers: ProviderSet = {
  sound: { play: async () => ({ status: "delivered" }) },
  voice: { speak: async () => ({ status: "delivered" }) },
  desktop: { show: async () => ({ status: "delivered" }) },
};

const store = new MemoryPipelineStore();
const working: SessionRecord = {
  adapterId: "adapter-a",
  sessionId: "crash-session",
  agentName: "Crash Agent",
  state: "working",
  stateConfidence: "authoritative",
  lastEventAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  lastVerifiedAt: new Date().toISOString(),
  pendingRequests: [],
  tasks: [],
  isSubagent: false,
};
store.saveSession(working);

const server = createPipeServer({
  pipeName,
  store,
  config: structuredClone(defaultConfig),
  providers,
  clock: { now: () => new Date().toISOString(), nowMs: () => Date.now() },
});

await server.ready;
writeFileSync(
  sessionsFile,
  JSON.stringify([...store.sessions.values()], null, 2),
  "utf8",
);
process.stdout.write("READY\n");

setInterval(() => {}, 60_000);
