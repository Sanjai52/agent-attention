import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { AGENT_EVENT_TYPES, IPC_PROTOCOL_VERSION, defaultConfig } from "@agent-attention/contract";
import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  IpcRequest,
  IpcResponse,
} from "@agent-attention/contract";
import type { Clock, PlannedNotification } from "@agent-attention/core";
import {
  createPipeServer,
  pipeNameForSid,
  type PipeServer,
} from "@agent-attention/host";
import type { ProviderSet } from "@agent-attention/notifications";
import {
  createPipelineStore,
  openDatabase,
  type AgentAttentionStore,
} from "@agent-attention/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEvent } from "../../unit/core/event-factory";

const PROGRESS_EVENTS = 500;
const BURST_SIZE = 50;
const DISPATCH_EVENTS = 50;
const LATENCY_TARGET_MS = 500;

type DispatchHook = (planned: PlannedNotification[]) => void;

interface TestClient {
  send(request: IpcRequest): Promise<IpcResponse>;
  dispose(): void;
}

function capabilities(adapterId: string): AdapterCapabilities {
  const events = Object.fromEntries(
    AGENT_EVENT_TYPES.map((eventType) => [eventType, { support: "authoritative" }]),
  ) as AdapterCapabilities["events"];

  return {
    adapterId,
    adapterVersion: "1.0.0",
    executionModel: "hook_process",
    events,
    eventIdsStable: true,
    supportsSequence: true,
    supportsTaskScope: true,
    supportsSubagents: true,
    supportsLiveness: true,
    supportsResolutionSignals: true,
  };
}

function hello(): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "hello-1",
    kind: "adapter_hello",
    payload: {
      adapterId: "latency-adapter",
      adapterVersion: "1.0.0",
      capabilities: capabilities("latency-adapter"),
    },
  };
}

function submit(event: unknown, id: string): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id,
    kind: "submit_event",
    payload: { event },
  };
}

function clock(): Clock {
  return {
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

function providers(): ProviderSet {
  return {
    sound: { play: async () => ({ status: "delivered" }) },
    voice: { speak: async () => ({ status: "delivered" }) },
    desktop: { show: async () => ({ status: "delivered" }) },
  };
}

function testConfig(): AgentAttentionConfig {
  const config = structuredClone(defaultConfig);
  config.rateLimit.maxAlertsPerMinute = 1000;
  return config;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Nearest-rank percentile; p95 of 500 samples is the 475th sorted value. */
function percentile(samples: readonly number[], percent: number): number {
  if (samples.length === 0) {
    return Number.NaN;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? Number.NaN;
}

async function connectToPipe(address: string): Promise<TestClient> {
  const socket: Socket = netConnect(address);
  socket.setEncoding("utf8");

  const pending: Array<{
    resolve: (response: IpcResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  let buffer = "";

  const failPending = (error: Error): void => {
    for (const waiter of pending.splice(0)) {
      waiter.reject(error);
    }
  };

  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = pending.shift();
      if (waiter === undefined) {
        failPending(new Error("unexpected response without a pending request"));
        return;
      }
      try {
        waiter.resolve(JSON.parse(line) as IpcResponse);
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error("invalid response JSON"));
      }
    }
  });
  socket.on("error", failPending);
  socket.on("close", () => failPending(new Error("pipe connection closed")));

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  return {
    send(request) {
      return new Promise<IpcResponse>((resolve, reject) => {
        pending.push({ resolve, reject });
        socket.write(`${JSON.stringify(request)}\n`);
      });
    },
    dispose() {
      socket.destroy();
    },
  };
}

describe.skipIf(process.platform !== "win32")("latency smoke", () => {
  let directory: string;
  let store: AgentAttentionStore;
  let server: PipeServer | undefined;
  let client: TestClient | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "agent-attention-latency-"));
    const db = openDatabase(join(directory, "agent-attention.db"), { busyTimeoutMs: 1000 });
    store = createPipelineStore(db, { retentionDays: 7 });
  });

  afterEach(async () => {
    client?.dispose();
    client = undefined;
    await server?.close();
    server = undefined;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function start(dispatch?: DispatchHook): Promise<void> {
    server = createPipeServer({
      pipeName: pipeNameForSid(
        `S-1-5-21-latency-${process.pid}-${randomBytes(5).toString("hex")}`,
      ),
      store,
      config: testConfig(),
      providers: providers(),
      clock: clock(),
      ...(dispatch === undefined ? {} : { dispatch }),
    });
    await server.ready;

    client = await connectToPipe(server.address);
    const response = await client.send(hello());
    expect(response.ok).toBe(true);
  }

  it(
    "keeps receipt-to-response p95 under 500 ms for 500 progress events",
    async () => {
      await start();

      const samples: number[] = [];

      for (let burst = 0; burst < PROGRESS_EVENTS / BURST_SIZE; burst += 1) {
        const burstRequests = Array.from({ length: BURST_SIZE }, (_, offset) => {
          const index = burst * BURST_SIZE + offset;
          const now = new Date().toISOString();
          const event = makeEvent({
            eventType: "agent.progress",
            eventId: `progress-${index}`,
            adapterId: "latency-adapter",
            sessionId: "progress-session",
            occurredAt: now,
            receivedAt: now,
            sequence: index + 1,
          });

          return { index, request: submit(event, `progress-request-${index}`) };
        });

        await Promise.all(
          burstRequests.map(async ({ index, request }) => {
            const startedAt = performance.now();
            const response = await client?.send(request);
            const elapsed = performance.now() - startedAt;

            expect(response?.ok, `progress event ${index} was rejected`).toBe(true);
            samples.push(elapsed);
          }),
        );

        if (burst < PROGRESS_EVENTS / BURST_SIZE - 1) {
          await delay(100);
        }
      }

      expect(samples).toHaveLength(PROGRESS_EVENTS);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);

      console.info(
        `[latency-smoke] receipt->response progress n=${samples.length} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
      );
      expect(p95).toBeLessThan(LATENCY_TARGET_MS);
    },
    20_000,
  );

  it(
    "keeps receipt-to-dispatch p95 under 500 ms for needs_input events",
    async () => {
      const dispatchedAt = new Map<string, number>();
      await start((planned) => {
        const at = performance.now();
        for (const notification of planned) {
          dispatchedAt.set(notification.eventId, at);
        }
      });

      const samples: number[] = [];

      for (let index = 0; index < DISPATCH_EVENTS; index += 1) {
        const now = new Date().toISOString();
        const event = makeEvent({
          eventType: "agent.needs_input",
          eventId: `needs-input-${index}`,
          adapterId: "latency-adapter",
          sessionId: `dispatch-session-${index}`,
          occurredAt: now,
          receivedAt: now,
          sequence: 1,
          details: { requestId: `request-${index}` },
        });

        const startedAt = performance.now();
        const response = await client?.send(
          submit(event, `needs-input-request-${index}`),
        );
        expect(response?.ok, `needs_input event ${index} was rejected`).toBe(true);

        const dispatched = dispatchedAt.get(event.eventId);
        expect(dispatched, `needs_input event ${index} never reached dispatch`).toBeDefined();
        samples.push((dispatched ?? startedAt) - startedAt);
      }

      expect(samples).toHaveLength(DISPATCH_EVENTS);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);

      console.info(
        `[latency-smoke] receipt->dispatch needs_input n=${samples.length} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
      );
      expect(p95).toBeLessThan(LATENCY_TARGET_MS);
    },
    20_000,
  );
});
