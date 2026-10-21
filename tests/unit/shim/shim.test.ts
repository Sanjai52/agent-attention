import { IPC_PROTOCOL_VERSION } from "@agent-attention/contract";
import type { AgentEvent, IpcRequest } from "@agent-attention/contract";
import {
  CONNECT_TIMEOUT_MS,
  SPAWN_RETRY_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  appendSpool,
  parseSpoolLines,
  runShim,
  sendToHost,
  spawnHostDetached,
  type ShimSocket,
} from "@agent-attention/shim";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, unrefMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
  unrefMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    eventIdStability: "source",
    eventType: "agent.needs_input",
    source: {
      adapterId: "adapter-a",
      adapterVersion: "1.0.0",
      agentId: "agent-a",
      agentName: "Agent A",
    },
    session: { sessionId: "session-1" },
    occurredAt: "2026-10-21T10:00:00Z",
    receivedAt: "2026-10-21T10:00:00Z",
    confidence: "authoritative",
    details: { summaryCode: "INPUT_REQUIRED", requestId: "req-1" },
    ...overrides,
  };
}

function submit(eventValue: AgentEvent): IpcRequest {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    id: "shim-request-1",
    kind: "submit_event",
    payload: { event: eventValue },
  };
}

class FakeSocket extends EventEmitter implements ShimSocket {
  written: string[] = [];
  destroyed = false;
  writeData: ((socket: FakeSocket) => void) | undefined;

  setEncoding(): void {}

  write(data: string): boolean {
    this.written.push(data);
    this.writeData?.(this);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }
}

function respond(socket: FakeSocket, response: unknown, delayMs = 1): void {
  socket.writeData = () => {
    const written = socket.written[socket.written.length - 1] ?? "{}";
    const request = JSON.parse(written) as { id?: string };
    const reply =
      typeof response === "object" && response !== null && "id" in response
        ? { ...(response as Record<string, unknown>), id: request.id }
        : response;
    setTimeout(() => {
      socket.emit("data", `${JSON.stringify(reply)}\n`);
    }, delayMs);
  };
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-attention-shim-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  spawnMock.mockClear();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("shim constants", () => {
  it("uses the PRD budget and bounded retry values", () => {
    expect(TOTAL_BUDGET_MS).toBe(950);
    expect(CONNECT_TIMEOUT_MS).toBe(200);
    expect(SPAWN_RETRY_TIMEOUT_MS).toBe(300);
  });
});

describe("sendToHost", () => {
  it("sends over the pipe and accepts a success ack without spawning or spooling", async () => {
    const dir = tempDir();
    const spawnHost = vi.fn(() => true);
    const socket = new FakeSocket();
    respond(socket, { id: "shim-request-1", ok: true, result: { status: "processed" } });

    const outcome = await sendToHost(submit(event()), {
      pipeName: "\\\\.\\pipe\\test",
      spoolDir: dir,
      spawnHost,
      connect: async () => socket,
    });

    expect(outcome).toEqual({ channel: "pipe", ok: true });
    expect(spawnHost).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
    expect(socket.written).toHaveLength(1);
    expect(socket.written[0]?.endsWith("\n")).toBe(true);
  });

  it("returns the host's error without spooling or retrying", async () => {
    const dir = tempDir();
    const spawnHost = vi.fn(() => true);
    const socket = new FakeSocket();
    respond(socket, {
      id: "shim-request-1",
      ok: false,
      error: { code: "rejected_event", message: "bad event" },
    });

    const outcome = await sendToHost(submit(event()), {
      spoolDir: dir,
      spawnHost,
      connect: async () => socket,
    });

    expect(outcome.channel).toBe("pipe");
    expect(outcome.ok).toBe(false);
    expect(spawnHost).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("spawns once, retries in one bounded phase, then spools when the pipe stays down", async () => {
    const dir = tempDir();
    const spawnHost = vi.fn(() => true);
    const connect = vi.fn(async () => {
      throw Object.assign(new Error("no pipe"), { code: "ENOENT" });
    });

    const outcome = await sendToHost(submit(event()), {
      spoolDir: dir,
      spawnHost,
      connect,
      budgetMs: 250,
      connectTimeoutMs: 20,
      retryTimeoutMs: 80,
      retryPollMs: 10,
    });

    expect(outcome.channel).toBe("spool");
    expect(outcome.ok).toBe(true);
    expect(spawnHost).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls.length).toBeGreaterThan(1);

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{13}-\d{6}-[0-9a-f]{8}\.jsonl$/);

    const content = readFileSync(join(dir, files[0] as string), "utf8");
    expect(parseSpoolLines(content).torn).toBe(false);
    expect(JSON.parse(content.trim())).toMatchObject({ eventId: "event-1" });
  });

  it("uses the spawn channel label when the retry phase succeeds", async () => {
    const dir = tempDir();
    const spawnHost = vi.fn(() => true);
    let attempts = 0;
    const connect = async (): Promise<ShimSocket> => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("ENOENT");
      }
      const socket = new FakeSocket();
      respond(socket, { id: "shim-request-1", ok: true, result: {} });
      return socket;
    };

    const outcome = await sendToHost(submit(event()), {
      spoolDir: dir,
      spawnHost,
      connect,
      budgetMs: 300,
      connectTimeoutMs: 20,
      retryTimeoutMs: 120,
      retryPollMs: 10,
    });

    expect(outcome).toEqual({ channel: "spawn", ok: true });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("never hangs when connect ignores its timeout", async () => {
    const dir = tempDir();
    const started = Date.now();
    const outcome = await sendToHost(submit(event()), {
      spoolDir: dir,
      spawnHost: () => true,
      connect: () => new Promise<ShimSocket>(() => {}),
      budgetMs: 80,
      connectTimeoutMs: 20,
      retryTimeoutMs: 20,
      retryPollMs: 5,
    });

    expect(outcome.channel).toBe("spool");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("spools two events in filename order", async () => {
    const dir = tempDir();
    const options = {
      spoolDir: dir,
      spawnHost: () => false,
      connect: async () => {
        throw new Error("ENOENT");
      },
      budgetMs: 60,
      connectTimeoutMs: 10,
      retryTimeoutMs: 10,
      retryPollMs: 5,
    };

    await sendToHost(submit(event({ eventId: "event-1" })), options);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sendToHost(submit(event({ eventId: "event-2" })), {
      ...options,
      budgetMs: 60,
      connectTimeoutMs: 10,
      retryTimeoutMs: 10,
      retryPollMs: 5,
    });

    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    const ids = files.map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")).eventId);
    expect(ids).toEqual(["event-1", "event-2"]);
  });
});

describe("spool files", () => {
  it("writes one atomic JSONL file per event and parses it", () => {
    const dir = tempDir();
    const path = appendSpool(event(), dir);
    const name = path.slice(dir.length + 1);

    expect(name).toMatch(/^\d{13}-\d{6}-[0-9a-f]{8}\.jsonl$/);
    const content = readFileSync(path, "utf8");
    expect(content.endsWith("\n")).toBe(true);
    expect(parseSpoolLines(content)).toEqual({ lines: [JSON.stringify(event())], torn: false });
    expect(readdirSync(dir)).toEqual([name]);
  });

  it("tolerates a torn final line and keeps complete lines", () => {
    const parsed = parseSpoolLines('{"a":1}\n{"b":2}\n{"c":');
    expect(parsed.torn).toBe(true);
    expect(parsed.lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("spawnHostDetached", () => {
  it("spawns hidden, detached, with ignored stdio and unrefs the child", () => {
    spawnMock.mockReturnValueOnce({ unref: unrefMock });
    spawnHostDetached({ entry: "C:\\host\\main.js", args: ["--pipe", "x"] });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["C:\\host\\main.js", "--pipe", "x"]);
    expect(options).toMatchObject({
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it("honors the explicit runtime override used by plugin hosts", () => {
    spawnMock.mockReturnValueOnce({ unref: unrefMock });
    spawnHostDetached({ entry: "C:\\host\\main.js", env: { AGENT_ATTENTION_NODE_EXECUTABLE: "node-custom.exe" } });

    const [command] = spawnMock.mock.calls[0] as unknown as [string];
    expect(command).toBe("node-custom.exe");
  });
});

describe("runShim", () => {
  it("returns 0 and stays silent for a valid event delivered over the pipe", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const socket = new FakeSocket();
    respond(socket, { id: "shim-request-1", ok: true, result: {} });

    const code = await runShim(JSON.stringify(event()), {
      spoolDir: tempDir(),
      connect: async () => socket,
    });

    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("returns 0 for malformed JSON and writes only a prefixed diagnostic", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runShim("{not json", { spoolDir: tempDir() })).resolves.toBe(0);

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^agent-attention: /));
  });

  it("returns 0 when the host is unreachable and the event is spooled", async () => {
    const dir = tempDir();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runShim(JSON.stringify(event()), {
      spoolDir: dir,
      spawnHost: () => true,
      connect: async () => {
        throw new Error("ENOENT");
      },
      budgetMs: 60,
      connectTimeoutMs: 10,
      retryTimeoutMs: 10,
      retryPollMs: 5,
    });

    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
