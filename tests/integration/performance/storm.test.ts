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
  createAudioQueue,
  dispatchPlanned,
  providerAudioPlayer,
  type ProviderSet,
} from "@agent-attention/notifications";
import { createPipeServer, pipeNameForSid, type PipeServer } from "@agent-attention/host";
import {
  createPipelineStore,
  openDatabase,
  type AgentAttentionStore,
} from "@agent-attention/storage";
import { afterEach, describe, expect, it } from "vitest";
import { makeEvent } from "../../unit/core/event-factory";

const EVENT_COUNT = 50;
const STORM_RATE_PER_SECOND = 50;
const RECEIPT_TO_DISPATCH_TARGET_MS = 500;

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

function hello(adapterId: string): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "hello-1",
    kind: "adapter_hello",
    payload: {
      adapterId,
      adapterVersion: "1.0.0",
      capabilities: capabilities(adapterId),
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
    now: () => "2026-10-21T10:00:00.000Z",
    nowMs: () => Date.parse("2026-10-21T10:00:00.000Z"),
  };
}

function config(): AgentAttentionConfig {
  const result = structuredClone(defaultConfig);
  result.rateLimit.maxAlertsPerMinute = 6;
  result.audio.maxQueueLength = 64;
  return result;
}

function connectToPipe(address: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
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
    socket.once("connect", () => {
      resolve({
        send(request) {
          return new Promise<IpcResponse>((sendResolve, sendReject) => {
            pending.push({ resolve: sendResolve, reject: sendReject });
            socket.write(`${JSON.stringify(request)}\n`);
          });
        },
        dispose() {
          socket.destroy();
        },
      });
    });
    socket.once("error", reject);
  });
}

function stormEvents(adapterId: string): ReturnType<typeof makeEvent>[] {
  return Array.from({ length: EVENT_COUNT }, (_, index) =>
    makeEvent({
      eventType: "agent.started",
      eventId: `storm-started-${index}`,
      adapterId,
      sessionId: `storm-session-${index}`,
      sequence: index + 1,
      occurredAt: "2026-10-21T10:00:00.000Z",
      receivedAt: "2026-10-21T10:00:00.000Z",
    }),
  );
}

describe.skipIf(process.platform !== "win32")("performance storm evidence", () => {
  let directory: string | undefined;
  let store: AgentAttentionStore | undefined;
  let server: PipeServer | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.dispose();
    client = undefined;
    await server?.close();
    server = undefined;
    store?.close();
    store = undefined;
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  async function start(
    dispatch?: (planned: PlannedNotification[]) => Promise<void>,
  ): Promise<void> {
    const adapterId = "performance-adapter";
    server = createPipeServer({
      pipeName: pipeNameForSid(
        `S-1-5-21-performance-${process.pid}-${randomBytes(5).toString("hex")}`,
      ),
      store: store!,
      config: config(),
      providers: providers(),
      clock: clock(),
      ...(dispatch === undefined ? {} : { dispatch }),
    });
    await server.ready;
    client = await connectToPipe(server.address);
    const response = await client.send(hello(adapterId));
    expect(response.ok).toBe(true);
  }

  function providers(): ProviderSet {
    return {
      sound: { play: async () => ({ status: "delivered" }) },
      voice: { speak: async () => ({ status: "delivered" }) },
      desktop: { show: async () => ({ status: "delivered" }) },
    };
  }

  function openStore(): void {
    directory = directory ?? mkdtempSync(join(tmpdir(), "agent-attention-storm-"));
    const db = openDatabase(join(directory, "agent-attention.db"), { busyTimeoutMs: 1_000 });
    store = createPipelineStore(db, { retentionDays: 7 });
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(predicate()).toBe(true);
  }

  it("handles a 50 events/sec storm through the real pipe and SQLite path", async () => {
    openStore();
    const dispatchTimes: number[] = [];
    await start(async (planned) => {
      dispatchTimes.push(...planned.map(() => performance.now()));
      const queue = createAudioQueue({
        maxQueueLength: 64,
        play: providerAudioPlayer(providers()),
      });
      await dispatchPlanned(planned, {
        providers: providers(),
        queue,
        recordDelivery: (record) => store?.recordDelivery(record),
        now: () => clock().now(),
      });
    });

    const events = stormEvents("performance-adapter");
    const startedAt = performance.now();
    const responses = await Promise.all(
      events.map((event, index) => client!.send(submit(event, `storm-request-${index}`))),
    );
    const elapsedMs = performance.now() - startedAt;
    const alertStartedAt = performance.now();
    const alert = makeEvent({
      eventType: "agent.needs_input",
      eventId: "storm-alert",
      adapterId: "performance-adapter",
      sessionId: "storm-alert-session",
      details: { summaryCode: "INPUT_REQUIRED", requestId: "storm-alert-request" },
      occurredAt: "2026-10-21T10:00:00.000Z",
      receivedAt: "2026-10-21T10:00:00.000Z",
    });
    const alertResponse = await client!.send(submit(alert, "storm-alert-request"));
    await waitFor(() => dispatchTimes.length > 0);
    const receiptToDispatchP95 = Math.max(...dispatchTimes) - alertStartedAt;
    const stored = store!.listEvents();

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(alertResponse.ok).toBe(true);
    expect(stored).toHaveLength(EVENT_COUNT + 1);
    expect(elapsedMs).toBeLessThan(1_000);
    expect(receiptToDispatchP95).toBeLessThan(RECEIPT_TO_DISPATCH_TARGET_MS);

    console.info(
      `[performance] storm n=${EVENT_COUNT} targetRate=${STORM_RATE_PER_SECOND}/s elapsed=${elapsedMs.toFixed(2)}ms receiptToDispatchP95=${receiptToDispatchP95.toFixed(2)}ms stored=${stored.length}`,
    );
  }, 20_000);

  it("replays an interrupted storm without duplicating SQLite event rows", async () => {
    openStore();
    await start();
    const events = stormEvents("performance-adapter");

    for (const [index, event] of events.slice(0, EVENT_COUNT / 2).entries()) {
      const response = await client!.send(submit(event, `interrupted-request-${index}`));
      expect(response.ok).toBe(true);
    }

    client?.dispose();
    client = undefined;
    await server?.close();
    server = undefined;
    store?.close();
    store = undefined;

    const db = openDatabase(join(directory!, "agent-attention.db"), { busyTimeoutMs: 1_000 });
    store = createPipelineStore(db, { retentionDays: 7 });
    await start();

    const replayResponses = await Promise.all(
      events.map((event, index) => client!.send(submit(event, `replay-request-${index}`))),
    );

    expect(replayResponses.every((response) => response.ok)).toBe(true);
    expect(store.listEvents()).toHaveLength(EVENT_COUNT);
    expect(new Set(store.listEvents().map(({ eventId }) => eventId)).size).toBe(EVENT_COUNT);
  }, 20_000);
});
