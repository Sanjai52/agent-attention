import { AGENT_EVENT_TYPES, defaultConfig, IPC_PROTOCOL_VERSION } from "@agent-attention/contract";
import type {
  AdapterCapabilities,
  AgentAttentionConfig,
  AgentEvent,
  IpcRequest,
  IpcResponse,
} from "@agent-attention/contract";
import type { Clock, ProviderSet } from "@agent-attention/host";
import { createConnection, createPipeServer, pipeNameForSid } from "@agent-attention/host";
import { connect as netConnect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPipelineStore } from "../../helpers/memory-store";

const NOW = "2026-10-21T10:00:00Z";

function clock(): Clock {
  return { now: () => NOW, nowMs: () => Date.parse(NOW) };
}

function capabilities(adapterId = "adapter-a"): AdapterCapabilities {
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

function providers(): ProviderSet {
  return {
    sound: { play: async () => ({ status: "delivered" }) },
    voice: { speak: async () => ({ status: "delivered" }) },
    desktop: { show: async () => ({ status: "delivered" }) },
  };
}

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    eventIdStability: "source",
    eventType: "agent.started",
    source: {
      adapterId: "adapter-a",
      adapterVersion: "1.0.0",
      agentId: "agent-a",
      agentName: "Agent A",
    },
    session: { sessionId: "session-1" },
    occurredAt: NOW,
    receivedAt: NOW,
    confidence: "authoritative",
    ...overrides,
  };
}

function hello(id = "hello-1", adapterId = "adapter-a"): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id,
    kind: "adapter_hello",
    payload: { adapterId, adapterVersion: "1.0.0", capabilities: capabilities(adapterId) },
  };
}

function submit(payload: unknown, id = "submit-1"): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id,
    kind: "submit_event",
    payload: { event: payload },
  };
}

function connection(options: {
  store?: MemoryPipelineStore;
  config?: AgentAttentionConfig;
  shutdown?: () => void;
} = {}) {
  const store = options.store ?? new MemoryPipelineStore();
  return {
    store,
    connection: createConnection({
      store,
      config: options.config ?? structuredClone(defaultConfig),
      providers: providers(),
      clock: clock(),
      ...(options.shutdown === undefined ? {} : { shutdown: options.shutdown }),
    }),
  };
}

describe("connection dispatcher", () => {
  it("binds AdapterHello to one adapter and reports the protocol version", async () => {
    const { connection: conn } = connection();

    const first = await conn.handleRequest(hello());
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.result).toMatchObject({ adapterId: "adapter-a", registered: true });
    }

    const second = await conn.handleRequest(hello("hello-2", "adapter-b"));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("invalid_payload");
    }
  });

  it("rejects SubmitEvent before AdapterHello", async () => {
    const { connection: conn } = connection();

    const response = await conn.handleRequest(submit(event()));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("rejected_event");
      expect(response.error.message).toMatch(/hello/i);
    }
  });

  it("submits a valid event through the pipeline and stores it", async () => {
    const { connection: conn, store } = connection();
    await conn.handleRequest(hello());

    const response = await conn.handleRequest(submit(event()));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toMatchObject({ status: "processed" });
    }
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.event.eventId).toBe("event-1");
  });

  it("rejects an event whose adapterId differs from the connection identity", async () => {
    const { connection: conn, store } = connection();
    await conn.handleRequest(hello());

    const response = await conn.handleRequest(
      submit(event({ source: { ...event().source, adapterId: "adapter-b" } })),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("rejected_event");
      expect(response.error.message).toMatch(/adapter-b/);
    }
    expect(store.events).toHaveLength(0);
    expect(store.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects an invalid event as rejected_event without closing the connection", async () => {
    const { connection: conn } = connection();
    await conn.handleRequest(hello());

    const bad = await conn.handleRequest(submit({ eventType: "agent.needs_input" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe("rejected_event");
    }

    const good = await conn.handleRequest(submit(event({ eventId: "event-2" }), "submit-2"));
    expect(good.ok).toBe(true);
  });

  it("serves ping, status, mute, unmute, and shutdown", async () => {
    const shutdown = vi.fn();
    const { connection: conn } = connection({ shutdown });

    const ping = await conn.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "ping-1",
      kind: "ping",
      payload: {},
    });
    expect(ping.ok).toBe(true);
    if (ping.ok) {
      expect(ping.result).toMatchObject({ pong: true, protocolVersion: 1 });
    }

    const status = await conn.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "status-1",
      kind: "status",
      payload: { json: true },
    });
    expect(status.ok).toBe(true);

    const mute = await conn.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "mute-1",
      kind: "mute",
      payload: { until: "2026-10-21T12:00:00Z" },
    });
    expect(mute.ok).toBe(true);

    const unmute = await conn.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "unmute-1",
      kind: "unmute",
      payload: {},
    });
    expect(unmute.ok).toBe(true);

    const stop = await conn.handleRequest({
      protocolVersion: IPC_PROTOCOL_VERSION,
      id: "shutdown-1",
      kind: "shutdown",
      payload: {},
    });
    expect(stop.ok).toBe(true);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when history or preview has no host handler", async () => {
    const { connection: conn } = connection();

    for (const request of [
      {
        protocolVersion: IPC_PROTOCOL_VERSION,
        id: "history-1",
        kind: "history",
        payload: { filters: {} },
      },
      {
        protocolVersion: IPC_PROTOCOL_VERSION,
        id: "preview-1",
        kind: "preview",
        payload: { eventClass: "needsInput", channel: "sound", voice: false },
      },
    ] satisfies IpcRequest[]) {
      const response = await conn.handleRequest(request);
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe("unavailable");
      }
    }
  });
});

function pipeName(): string {
  return pipeNameForSid(`S-1-5-21-test-${process.pid}-${randomBytes(4).toString("hex")}`);
}

interface TestClient {
  socket: Socket;
  send(line: string): Promise<IpcResponse>;
  closed(): Promise<void>;
  dispose(): void;
}

async function connectToPipe(path: string): Promise<TestClient> {
  const socket = netConnect(path);
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let buffer = "";

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        lines.push(line);
      } else {
        waiter(line);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    send(line: string) {
      socket.write(`${line}\n`);
      return new Promise<IpcResponse>((resolve, reject) => {
        const take = (next: string) => {
          try {
            resolve(JSON.parse(next) as IpcResponse);
          } catch (error) {
            reject(error);
          }
        };
        const buffered = lines.shift();
        if (buffered !== undefined) {
          take(buffered);
          return;
        }
        waiters.push(take);
      });
    },
    closed() {
      return new Promise((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.once("close", () => resolve());
      });
    },
    dispose() {
      socket.destroy();
    },
  };
}

describe.skipIf(process.platform !== "win32")("named pipe server", () => {
  const servers: Array<{ close(): Promise<void> }> = [];
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.dispose();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  async function start(overrides: Record<string, unknown> = {}) {
    const store = new MemoryPipelineStore();
    const server = createPipeServer({
      pipeName: pipeName(),
      store,
      config: structuredClone(defaultConfig),
      providers: providers(),
      clock: clock(),
      ...overrides,
    });
    servers.push(server);
    await server.ready;
    return { server, store };
  }

  it("answers malformed JSON, keeps the connection open, then serves a hello", async () => {
    const { server } = await start();
    const client = await connectToPipe(server.address);
    clients.push(client);

    const malformed = await client.send('{"protocolVersion":1,"id":"broken",');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.error.code).toBe("invalid_payload");
    }

    const helloResponse = await client.send(JSON.stringify(hello()));
    expect(helloResponse.ok).toBe(true);
  });

  it("completes a hello and submit round-trip and persists the event", async () => {
    const { server, store } = await start();
    const client = await connectToPipe(server.address);
    clients.push(client);

    expect((await client.send(JSON.stringify(hello()))).ok).toBe(true);
    const response = await client.send(JSON.stringify(submit(event())));
    expect(response.ok).toBe(true);
    expect(store.events).toHaveLength(1);
  });

  it("drops a connection that does not complete AdapterHello within the timeout", async () => {
    const { server } = await start({ helloTimeoutMs: 60 });
    const client = await connectToPipe(server.address);
    clients.push(client);

    const started = Date.now();
    await client.closed();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("rejects an oversized line with a typed error", async () => {
    const { server } = await start();
    const client = await connectToPipe(server.address);
    clients.push(client);

    const oversized = JSON.stringify({
      protocolVersion: 1,
      id: "big",
      kind: "ping",
      payload: { text: "x".repeat(300 * 1024) },
    });
    const response = await client.send(oversized);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("invalid_payload");
    }
  });

  it("calls the ACL hook after listen and reports whether it hardened", async () => {
    const hardenPipeAcl = vi.fn(async () => {});
    const { server } = await start({ hardenPipeAcl });

    expect(hardenPipeAcl).toHaveBeenCalledWith(server.address);
    expect(server.aclHardened).toBe(true);
  });

  it("fails closed when the ACL hook itself fails", async () => {
    const store = new MemoryPipelineStore();
    const server = createPipeServer({
      pipeName: pipeName(),
      store,
      config: structuredClone(defaultConfig),
      providers: providers(),
      clock: clock(),
      hardenPipeAcl: async () => {
        throw new Error("no helper");
      },
    });

    await expect(server.ready).rejects.toThrow(/no helper/);
  });
});
