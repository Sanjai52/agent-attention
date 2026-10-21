import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildPowerShellArgs,
  createFixedScriptRunner,
  type SpawnedProcess,
  type SpawnProcess,
  type SpawnProcessOptions,
} from "@agent-attention/platform-windows";

class FakeStdin {
  chunks: Array<string | undefined> = [];
  ended = false;

  end(data?: string): void {
    this.chunks.push(data);
    this.ended = true;
  }
}

class FakeChild extends EventEmitter {
  readonly stdin = new FakeStdin();
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killCalls = 0;

  kill(): boolean {
    this.killCalls += 1;
    return true;
  }
}

function asSpawned(child: FakeChild): SpawnedProcess {
  return child as unknown as SpawnedProcess;
}

describe("buildPowerShellArgs", () => {
  it("uses fixed PowerShell flags and appends script arguments as data", () => {
    expect(
      buildPowerShellArgs("C:\\app\\scripts\\play-sound.ps1", [
        "-Path",
        "C:\\sounds\\attention.wav",
      ]),
    ).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\app\\scripts\\play-sound.ps1",
      "-Path",
      "C:\\sounds\\attention.wav",
    ]);
  });
});

describe("createFixedScriptRunner", () => {
  it("spawns powershell.exe without a shell and hides the window", async () => {
    const child = new FakeChild();
    const calls: Array<{
      command: string;
      args: string[];
      options: SpawnProcessOptions;
    }> = [];
    const spawnProcess: SpawnProcess = (command, args, options) => {
      calls.push({ command, args, options });
      return asSpawned(child);
    };
    const run = createFixedScriptRunner(spawnProcess);

    const promise = run({
      scriptPath: "C:\\scripts\\play-sound.ps1",
      args: ["-Path", "C:\\sounds\\attention.wav"],
      timeoutMs: 5_000,
    });
    child.emit("close", 0);
    const result = await promise;

    expect(result).toMatchObject({ code: 0, timedOut: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("powershell.exe");
    expect(calls[0]?.args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\scripts\\play-sound.ps1",
      "-Path",
      "C:\\sounds\\attention.wav",
    ]);
    expect(calls[0]?.options).toMatchObject({
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(calls[0]?.options).not.toHaveProperty("shell");
  });

  it("writes stdin once and closes it, including UTF-8 text", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);
    const text = '"; rm -rf ~ # \u202E$(x) \u0001';

    const promise = run({
      scriptPath: "C:\\scripts\\speak.ps1",
      args: [],
      stdin: text,
      timeoutMs: 5_000,
    });
    expect(child.stdin.chunks).toEqual([text]);
    expect(child.stdin.ended).toBe(true);

    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ code: 0 });
  });

  it("closes stdin even when there is no payload", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);

    const promise = run({
      scriptPath: "C:\\scripts\\focus.ps1",
      args: [],
      timeoutMs: 5_000,
    });
    expect(child.stdin.ended).toBe(true);
    expect(child.stdin.chunks).toEqual([undefined]);

    child.emit("close", 0);
    await promise;
  });

  it("kills the child on timeout and reports timedOut", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);

    const promise = run({
      scriptPath: "C:\\scripts\\speak.ps1",
      args: [],
      timeoutMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(child.killCalls).toBe(1);
    child.emit("close", null);

    await expect(promise).resolves.toMatchObject({
      code: -1,
      timedOut: true,
      aborted: false,
    });
  });

  it("kills the child when the abort signal fires", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);
    const controller = new AbortController();

    const promise = run({
      scriptPath: "C:\\scripts\\speak.ps1",
      args: [],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    expect(child.killCalls).toBe(1);
    child.emit("close", null);

    await expect(promise).resolves.toMatchObject({
      aborted: true,
      timedOut: false,
    });
  });

  it("captures stdout/stderr and a non-zero exit code", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);

    const promise = run({
      scriptPath: "C:\\scripts\\play-sound.ps1",
      args: [],
      timeoutMs: 5_000,
    });
    child.stdout.emit("data", Buffer.from('{"ok":true}'));
    child.stderr.emit("data", Buffer.from("failed loudly"));
    child.emit("close", 2);

    await expect(promise).resolves.toEqual({
      code: 2,
      stdout: '{"ok":true}',
      stderr: "failed loudly",
      timedOut: false,
      aborted: false,
    });
  });

  it("resolves a spawn failure instead of throwing", async () => {
    const child = new FakeChild();
    const spawnProcess: SpawnProcess = () => asSpawned(child);
    const run = createFixedScriptRunner(spawnProcess);

    const promise = run({
      scriptPath: "C:\\scripts\\play-sound.ps1",
      args: [],
      timeoutMs: 5_000,
    });
    child.emit("error", new Error("spawn ENOENT"));

    await expect(promise).resolves.toMatchObject({
      code: -1,
      spawnError: "spawn ENOENT",
    });
  });
});
