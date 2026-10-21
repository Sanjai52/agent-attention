import { defaultConfig } from "@agent-attention/contract";
import type { AgentEvent, AgentAttentionConfig } from "@agent-attention/contract";
import { RollingRateLimiter, processEvent, type PipelineDependencies } from "@agent-attention/core";
import { ingestSpool, runHost, type HostRuntime } from "@agent-attention/host";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPipelineStore } from "../../helpers/memory-store";

const NOW = "2026-10-21T10:00:00Z";

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
    occurredAt: NOW,
    receivedAt: NOW,
    confidence: "authoritative",
    details: { summaryCode: "INPUT_REQUIRED", requestId: "request-1" },
    ...overrides,
  };
}

function pipeline(store = new MemoryPipelineStore()): {
  store: MemoryPipelineStore;
  submit: (input: AgentEvent) => Promise<ReturnType<typeof processEvent>>;
} {
  const config: AgentAttentionConfig = structuredClone(defaultConfig);
  const deps: PipelineDependencies = {
    store,
    config,
    clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
    rateLimiter: new RollingRateLimiter(config.rateLimit.maxAlertsPerMinute),
    quietHoursMinutes: () => 12 * 60,
  };

  return {
    store,
    submit: async (input) => processEvent(input, deps),
  };
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-attention-spool-ingest-"));
  tempDirs.push(dir);
  return dir;
}

function spoolFile(dir: string, epoch: number, pid: number, random: string): string {
  return join(
    dir,
    `${String(epoch).padStart(13, "0")}-${String(pid).padStart(6, "0")}-${random}.jsonl`,
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ingestSpool", () => {
  it("ingests visible files in filename order and deletes them after success", async () => {
    const dir = tempDir();
    const files = [
      spoolFile(dir, 1_000, 10, "aaaaaaaa"),
      spoolFile(dir, 1_001, 10, "bbbbbbbb"),
      spoolFile(dir, 1_002, 10, "cccccccc"),
    ];
    files.forEach((file, index) => {
      writeFileSync(file, `${JSON.stringify(event({ eventId: `event-${index + 1}` }))}\n`);
    });
    writeFileSync(join(dir, ".temporary.tmp"), "ignored");

    const seen: string[] = [];
    const result = await ingestSpool(dir, async (input) => {
      seen.push(input.eventId);
      return { status: "processed", planned: [], timers: [], diagnostics: [] };
    });

    expect(result).toEqual({ ingested: 3, rejected: 0 });
    expect(seen).toEqual(["event-1", "event-2", "event-3"]);
    expect(readdirSync(dir)).toEqual([".temporary.tmp"]);
  });

  it("deduplicates a replayed event and still deletes the file", async () => {
    const dir = tempDir();
    const { store, submit } = pipeline();
    const replay = event();

    writeFileSync(spoolFile(dir, 2_000, 11, "aaaaaaaa"), `${JSON.stringify(replay)}\n`);
    writeFileSync(spoolFile(dir, 2_001, 11, "bbbbbbbb"), `${JSON.stringify(replay)}\n`);

    const result = await ingestSpool(dir, submit);

    expect(result).toEqual({ ingested: 2, rejected: 0 });
    expect(store.events).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("quarantines a malformed line but still ingests the other lines", async () => {
    const dir = tempDir();
    const file = spoolFile(dir, 3_000, 12, "aaaaaaaa");
    writeFileSync(
      file,
      [
        JSON.stringify(event({ eventId: "event-good-1" })),
        "{not json",
        JSON.stringify(event({ eventId: "event-good-2" })),
      ].join("\n") + "\n",
    );

    const { store, submit } = pipeline();
    const result = await ingestSpool(dir, submit);

    expect(result).toEqual({ ingested: 2, rejected: 1 });
    expect(store.events).toHaveLength(2);
    expect(readdirSync(dir)).toEqual(["0000000003000-000012-aaaaaaaa.rejected.jsonl"]);
    expect(
      readFileSync(join(dir, "0000000003000-000012-aaaaaaaa.rejected.jsonl"), "utf8"),
    ).toContain("{not json");
  });

  it("tolerates a torn final line, keeps the file, and retries it next start", async () => {
    const dir = tempDir();
    const file = spoolFile(dir, 4_000, 13, "aaaaaaaa");
    const tornEvent = event({ eventId: "event-torn" });
    const tornJson = JSON.stringify(tornEvent);
    writeFileSync(
      file,
      `${JSON.stringify(event({ eventId: "event-complete" }))}\n${tornJson.slice(0, 20)}`,
    );

    const first = pipeline();
    const firstResult = await ingestSpool(dir, first.submit);

    expect(firstResult).toEqual({ ingested: 1, rejected: 0 });
    expect(first.store.events).toHaveLength(1);
    expect(readdirSync(dir)).toEqual(["0000000004000-000013-aaaaaaaa.jsonl"]);

    appendFileSync(file, `${tornJson.slice(20)}\n`);
    const second = pipeline(first.store);
    const secondResult = await ingestSpool(dir, second.submit);

    // The replayed complete line is deduplicated by eventId.
    expect(secondResult).toEqual({ ingested: 2, rejected: 0 });
    expect(second.store.events).toHaveLength(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("returns zero for a missing directory", async () => {
    await expect(
      ingestSpool(join(tempDir(), "missing"), async () => ({
        status: "processed",
        planned: [],
        timers: [],
        diagnostics: [],
      })),
    ).resolves.toEqual({ ingested: 0, rejected: 0 });
  });
});

describe("runHost spool integration", () => {
  it("ingests the spool before serving and before reconciliation", async () => {
    const dir = tempDir();
    const file = spoolFile(dir, 5_000, 14, "aaaaaaaa");
    writeFileSync(file, `${JSON.stringify(event())}\n`);

    const calls: string[] = [];
    const store = new MemoryPipelineStore();
    const config: AgentAttentionConfig = structuredClone(defaultConfig);
    const runtime: HostRuntime = {
      store,
      config,
      providers: {
        sound: { play: async () => ({ status: "delivered" }) },
        voice: { speak: async () => ({ status: "delivered" }) },
        desktop: { show: async () => ({ status: "delivered" }) },
      },
      clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
      migrate: () => {
        calls.push("migrate");
      },
      ingestSpool: vi.fn(async (spoolDir: string) => {
        calls.push("ingest-spool");
        return ingestSpool(spoolDir, async (input) => {
          calls.push("submit");
          return processEvent(input, {
            store,
            config,
            clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
            rateLimiter: new RollingRateLimiter(config.rateLimit.maxAlertsPerMinute),
            quietHoursMinutes: () => 12 * 60,
          });
        });
      }),
      listSessions: () => {
        calls.push("reconcile");
        return [];
      },
    };

    const controller = new AbortController();
    let ready = false;
    const run = runHost(
      [
        "--pipe",
        `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${Date.now()}`,
        "--spool-dir",
        dir,
        "--no-idle-exit",
      ],
      runtime,
      {
        signal: controller.signal,
        onReady: () => {
          ready = true;
        },
      },
    );

    const started = Date.now();
    while (!ready && Date.now() - started < 3_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(["migrate", "ingest-spool", "submit", "reconcile"]);
    expect(store.events).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("uses the real spool ingester when the runtime does not override it", async () => {
    const dir = tempDir();
    writeFileSync(spoolFile(dir, 6_000, 15, "aaaaaaaa"), `${JSON.stringify(event())}\n`);

    const store = new MemoryPipelineStore();
    const runtime: HostRuntime = {
      store,
      config: structuredClone(defaultConfig),
      providers: {
        sound: { play: async () => ({ status: "delivered" }) },
        voice: { speak: async () => ({ status: "delivered" }) },
        desktop: { show: async () => ({ status: "delivered" }) },
      },
      clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
      migrate: () => {},
      listSessions: () => [],
    };

    const controller = new AbortController();
    let ready = false;
    const run = runHost(
      [
        "--pipe",
        `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${Date.now()}`,
        "--spool-dir",
        dir,
        "--no-idle-exit",
      ],
      runtime,
      {
        signal: controller.signal,
        onReady: () => {
          ready = true;
        },
      },
    );

    const started = Date.now();
    while (!ready && Date.now() - started < 3_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(store.events).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
