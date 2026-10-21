import { defaultConfig } from "@agent-attention/contract";
import type { AgentAttentionConfig } from "@agent-attention/contract";
import type { SessionRecord } from "@agent-attention/core";
import {
  createTimerRegistry,
  isLiveSessionState,
  reconcileSessions,
  runHost,
  shouldExit,
  type HostRuntime,
  type HostTimerInstruction,
  type ProviderSet,
} from "@agent-attention/host";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPipelineStore } from "../../helpers/memory-store";

const NOW = "2026-10-21T10:00:00Z";
const MINUTE = 60_000;

function providers(): ProviderSet {
  return {
    sound: { play: async () => ({ status: "delivered" }) },
    voice: { speak: async () => ({ status: "delivered" }) },
    desktop: { show: async () => ({ status: "delivered" }) },
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    adapterId: "adapter-a",
    sessionId: "session-1",
    agentName: "Agent A",
    state: "working",
    stateConfidence: "authoritative",
    lastEventAt: NOW,
    lastSeenAt: NOW,
    lastVerifiedAt: NOW,
    pendingRequests: [],
    tasks: [],
    isSubagent: false,
    ...overrides,
  };
}

interface TestRuntime extends HostRuntime {
  calls: string[];
  store: MemoryPipelineStore;
  config: AgentAttentionConfig;
  migrate: ReturnType<typeof vi.fn>;
  ingestSpool: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
}

function runtime(overrides: Partial<HostRuntime> & { sessions?: SessionRecord[] } = {}): TestRuntime {
  const calls: string[] = [];
  const store = new MemoryPipelineStore();
  const sessions = overrides.sessions ?? [];
  for (const item of sessions) {
    store.saveSession(item);
  }

  const testRuntime: TestRuntime = {
    store,
    config: structuredClone(defaultConfig),
    providers: providers(),
    clock: { now: () => NOW, nowMs: () => Date.parse(NOW) },
    calls,
    migrate: vi.fn(() => {
      calls.push("migrate");
    }),
    ingestSpool: vi.fn(async () => {
      calls.push("ingest-spool");
      return { ingested: 0, rejected: 0 };
    }),
    shutdown: vi.fn(async () => {
      calls.push("shutdown");
    }),
    listSessions: () => {
      calls.push("list-sessions");
      return sessions;
    },
    ...overrides,
  };

  return testRuntime;
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("shouldExit", () => {
  const base = {
    activeSessions: 0,
    openConnections: 0,
    lastActivityAt: Date.parse(NOW),
    nowMs: Date.parse(NOW) + 10 * MINUTE,
    idleMinutes: 10,
  };

  it("exits only after the idle window with nothing live", () => {
    expect(shouldExit(base)).toBe(true);
    expect(shouldExit({ ...base, nowMs: base.nowMs - 1 })).toBe(false);
  });

  it("never exits while a working or waiting session exists", () => {
    expect(shouldExit({ ...base, activeSessions: 1 })).toBe(false);
    expect(shouldExit({ ...base, idleMinutes: 10, activeSessions: 2 })).toBe(false);
  });

  it("never exits while a client is connected", () => {
    expect(shouldExit({ ...base, openConnections: 1 })).toBe(false);
  });

  it("treats invalid clocks as not idle", () => {
    expect(shouldExit({ ...base, nowMs: Number.NaN })).toBe(false);
    expect(shouldExit({ ...base, lastActivityAt: Number.NaN })).toBe(false);
  });

  it("treats only working, waiting, and idle states as live", () => {
    expect(isLiveSessionState("working")).toBe(true);
    expect(isLiveSessionState("waiting_for_input")).toBe(true);
    expect(isLiveSessionState("waiting_for_approval")).toBe(true);
    expect(isLiveSessionState("idle")).toBe(true);
    expect(isLiveSessionState("unknown")).toBe(false);
    expect(isLiveSessionState("completed")).toBe(false);
    expect(isLiveSessionState("failed")).toBe(false);
    expect(isLiveSessionState("ended")).toBe(false);
  });
});

describe("TimerRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms and fires a timer at its due time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const fired: HostTimerInstruction[] = [];
    const registry = createTimerRegistry({ onFire: (instruction) => fired.push(instruction) });

    registry.arm({
      kind: "grace",
      sessionKey: "adapter-a:session-1",
      dueAt: "2026-10-21T10:00:01Z",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(fired).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.kind).toBe("grace");
    expect(registry.size).toBe(0);
    registry.dispose();
  });

  it("replaces a timer with the same identity instead of stacking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const fired: HostTimerInstruction[] = [];
    const registry = createTimerRegistry({ onFire: (instruction) => fired.push(instruction) });

    registry.arm({ kind: "stale", sessionKey: "s", dueAt: "2026-10-21T10:00:01Z" });
    registry.arm({ kind: "stale", sessionKey: "s", dueAt: "2026-10-21T10:00:02Z" });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.dueAt).toBe("2026-10-21T10:00:02Z");
    registry.dispose();
  });

  it("cancels by kind and session key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const fired: HostTimerInstruction[] = [];
    const registry = createTimerRegistry({ onFire: (instruction) => fired.push(instruction) });

    registry.arm({ kind: "reminder", sessionKey: "s", requestId: "r1", dueAt: "2026-10-21T10:00:01Z" });
    registry.arm({ kind: "stale", sessionKey: "s", dueAt: "2026-10-21T10:00:01Z" });
    registry.cancel("reminder", "s");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired.map((item) => item.kind)).toEqual(["stale"]);
    expect(registry.size).toBe(0);
    registry.dispose();
  });

  it("dispose clears every timer without firing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const fired: HostTimerInstruction[] = [];
    const registry = createTimerRegistry({ onFire: (instruction) => fired.push(instruction) });

    registry.arm({ kind: "grace", sessionKey: "a", dueAt: "2026-10-21T10:00:01Z" });
    registry.arm({ kind: "host_exit", sessionKey: "host", dueAt: "2026-10-21T10:01:00Z" });
    expect(registry.size).toBe(2);

    registry.dispose();
    expect(registry.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fired).toHaveLength(0);
  });
});

describe("restart reconciliation", () => {
  it("demotes working sessions and preserves waiting, idle, and terminal ones", () => {
    const sessions = [
      session({ sessionId: "working", state: "working" }),
      session({ sessionId: "waiting", state: "waiting_for_input" }),
      session({ sessionId: "idle", state: "idle" }),
      session({ sessionId: "completed", state: "completed" }),
      session({ sessionId: "failed", state: "failed" }),
      session({ sessionId: "ended", state: "ended" }),
    ];

    const reconciled = reconcileSessions(sessions, NOW);
    const states = Object.fromEntries(
      reconciled.map((item) => [item.sessionId, [item.state, item.stateConfidence]]),
    );

    expect(states.working).toEqual(["unknown", "unverified"]);
    expect(states.waiting).toEqual(["waiting_for_input", "authoritative"]);
    expect(states.idle).toEqual(["idle", "authoritative"]);
    expect(states.completed).toEqual(["completed", "authoritative"]);
    expect(states.failed).toEqual(["failed", "authoritative"]);
    expect(states.ended).toEqual(["ended", "authoritative"]);
  });
});

describe("runHost", () => {
  it("creates the pipe before side effects, then migrates, ingests, and reconciles", async () => {
    const working = session();
    const completed = session({ sessionId: "done", state: "completed" });
    const testRuntime = runtime({ sessions: [working, completed] });
    const pipeName = `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${Date.now()}`;
    const controller = new AbortController();
    let ready = false;

    const run = runHost(["--pipe", pipeName, "--no-idle-exit"], testRuntime, {
      signal: controller.signal,
      onReady: () => {
        ready = true;
      },
    });

    await waitFor(() => ready);
    expect(testRuntime.calls.slice(0, 3)).toEqual(["migrate", "ingest-spool", "list-sessions"]);
    expect(testRuntime.store.sessions.get("adapter-a\u0000session-1")?.state).toBe("unknown");
    expect(testRuntime.store.sessions.get("adapter-a\u0000done")?.state).toBe("completed");

    controller.abort();
    await expect(run).resolves.toBe(0);
    expect(testRuntime.calls).toContain("shutdown");
  });

  it("skips spool ingestion when --no-ingest is passed", async () => {
    const testRuntime = runtime();
    const controller = new AbortController();
    let ready = false;

    const run = runHost(
      ["--pipe", `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${Date.now()}`, "--no-ingest", "--no-idle-exit"],
      testRuntime,
      { signal: controller.signal, onReady: () => { ready = true; } },
    );

    await waitFor(() => ready);
    expect(testRuntime.ingestSpool).not.toHaveBeenCalled();
    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("exits with code 0 after the idle window when nothing is live", async () => {
    const testRuntime = runtime();
    const controller = new AbortController();
    let ready = false;

    const result = await runHost(
      ["--pipe", `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${Date.now()}`, "--idle-minutes", "0"],
      testRuntime,
      {
        signal: controller.signal,
        idleCheckIntervalMs: 20,
        onReady: () => {
          ready = true;
        },
      },
    );

    expect(ready).toBe(true);
    expect(result).toBe(0);
    expect(testRuntime.shutdown).toHaveBeenCalledTimes(1);
  });

  it("returns 1 without a runtime instead of opening anything", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runHost([], undefined)).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("runtime unavailable"));
    stderr.mockRestore();
  });
});
