import { describe, expect, it } from "vitest";
import { createWindowsFocusProvider } from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "./fake-runner";

const SCRIPT_PATH = "C:\\app\\scripts\\focus.ps1";

describe("createWindowsFocusProvider", () => {
  it("returns the foreground process identity", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        stdout: JSON.stringify({
          processId: 4242,
          executable: "WindowsTerminal.exe",
          windowHandle: "0x13098A",
          windowTitle: "agent-attention",
        }),
      }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toEqual({
      processId: 4242,
      executable: "WindowsTerminal.exe",
    });
    expect(runner.calls[0]?.options.scriptPath).toBe(SCRIPT_PATH);
    expect(runner.calls[0]?.options.args).toEqual([]);
  });

  it("normalizes a full executable path to its file name", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        stdout: JSON.stringify({
          processId: 99,
          executable: "C:\\Program Files\\WindowsApps\\WindowsTerminal.exe",
        }),
      }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toEqual({
      processId: 99,
      executable: "WindowsTerminal.exe",
    });
  });

  it("returns undefined when no window is foreground", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        stdout: JSON.stringify({ processId: 0, executable: null }),
      }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it("returns undefined when the helper exits non-zero", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 1, stderr: "GetForegroundWindow failed" }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    // AC-F13-03: detection failure must not be turned into suppression.
    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it("returns undefined for malformed helper output", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ stdout: "<not-json>" }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it.each([
    ["a missing process id", { executable: "WindowsTerminal.exe" }],
    ["a zero process id", { processId: 0, executable: "WindowsTerminal.exe" }],
    ["a missing executable", { processId: 123 }],
    ["an empty executable", { processId: 123, executable: "  " }],
    ["a non-numeric process id", { processId: "123", executable: "cmd.exe" }],
  ])("returns undefined for %s", async (_label, payload) => {
    const runner = createFakeRunner(() =>
      scriptResult({ stdout: JSON.stringify(payload) }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it("returns undefined on timeout", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, timedOut: true }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it("returns undefined on a spawn error", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, spawnError: "spawn powershell.exe ENOENT" }),
    );
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });

  it("never throws when the runner rejects", async () => {
    const provider = createWindowsFocusProvider({
      scriptPath: SCRIPT_PATH,
      runScript: async () => {
        throw new Error("unexpected");
      },
    });

    await expect(provider.getForeground()).resolves.toBeUndefined();
  });
});
