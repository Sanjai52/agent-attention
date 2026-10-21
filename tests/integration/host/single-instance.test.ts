import { defaultConfig } from "@agent-attention/contract";
import type { SessionRecord } from "@agent-attention/core";
import {
  runHost,
  type HostRuntime,
  type ProviderSet,
} from "@agent-attention/host";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPipelineStore } from "../../helpers/memory-store";

const IS_WINDOWS = process.platform === "win32";

function providers(): ProviderSet {
  return {
    sound: { play: async () => ({ status: "delivered" }) },
    voice: { speak: async () => ({ status: "delivered" }) },
    desktop: { show: async () => ({ status: "delivered" }) },
  };
}

function pipeName(suffix: string): string {
  return `\\\\.\\pipe\\agent-attention-u-test-${process.pid}-${suffix}-${Date.now()}`;
}

interface TestRuntime extends HostRuntime {
  store: MemoryPipelineStore;
  calls: string[];
  migrate: ReturnType<typeof vi.fn>;
  ingestSpool: ReturnType<typeof vi.fn>;
}

function runtime(sessions: SessionRecord[] = []): TestRuntime {
  const store = new MemoryPipelineStore();
  for (const session of sessions) {
    store.saveSession(session);
  }
  const calls: string[] = [];

  return {
    store,
    config: structuredClone(defaultConfig),
    providers: providers(),
    clock: { now: () => new Date().toISOString(), nowMs: () => Date.now() },
    calls,
    migrate: vi.fn(() => {
      calls.push("migrate");
    }),
    ingestSpool: vi.fn(async () => {
      calls.push("ingest");
      return { ingested: 0, rejected: 0 };
    }),
    listSessions: () => sessions,
    shutdown: vi.fn(async () => {
      calls.push("shutdown");
    }),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitForChildReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveReady, reject) => {
    let output = "";
    let errors = "";
    const timer = setTimeout(() => reject(new Error(`child did not start: ${errors}`)), 10_000);

    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes("READY")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      errors += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited before ready (code ${code}): ${errors}`));
    });
  });
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-attention-single-instance-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!IS_WINDOWS)("single instance and restart", () => {
  it("lets exactly one host own the pipe; the second exits 0 with no store work", async () => {
    const name = pipeName("exclusive");
    const first = runtime();
    const second = runtime();
    const firstController = new AbortController();
    let firstReady = false;

    const firstRun = runHost(["--pipe", name, "--no-idle-exit"], first, {
      signal: firstController.signal,
      onReady: () => {
        firstReady = true;
      },
    });

    await waitFor(() => firstReady);
    await expect(
      runHost(["--pipe", name, "--no-idle-exit"], second, {}),
    ).resolves.toBe(0);

    expect(second.migrate).not.toHaveBeenCalled();
    expect(second.ingestSpool).not.toHaveBeenCalled();

    firstController.abort();
    await expect(firstRun).resolves.toBe(0);
  });

  it("recovers the OS pipe and reconciles sessions after the host is killed", async () => {
    const name = pipeName("crash");
    const dir = tempDir();
    const sessionsFile = join(dir, "sessions.json");

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("tests/helpers/host-pipe-holder.ts"),
        name,
        sessionsFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    ) as unknown as ChildProcessWithoutNullStreams;

    let childExited: Promise<void>;
    try {
      await waitForChildReady(child);
      const stored = JSON.parse(readFileSync(sessionsFile, "utf8")) as SessionRecord[];
      expect(stored[0]?.state).toBe("working");

      childExited = new Promise((resolveExit) => child.once("exit", () => resolveExit()));
      process.kill(child.pid as number, "SIGKILL");
      await childExited;
    } finally {
      child.kill("SIGKILL");
    }

    const sessions = JSON.parse(readFileSync(sessionsFile, "utf8")) as SessionRecord[];
    const restarted = runtime(sessions);
    const controller = new AbortController();
    let ready = false;

    const run = runHost(["--pipe", name, "--no-idle-exit", "--no-ingest"], restarted, {
      signal: controller.signal,
      onReady: () => {
        ready = true;
      },
    });

    await waitFor(() => ready);
    expect(restarted.store.sessions.get("adapter-a\u0000crash-session")?.state).toBe(
      "unknown",
    );

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
