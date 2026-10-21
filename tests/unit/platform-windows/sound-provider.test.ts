import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWindowsSoundProvider } from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "./fake-runner";

const DEFAULT_SOUNDS_DIR = fileURLToPath(
  new URL("../../../packages/platform-windows/assets/sounds/", import.meta.url),
);

describe("createWindowsSoundProvider", () => {
  let tempDir: string;
  let scriptsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agent-attention-sound-"));
    scriptsDir = path.join(tempDir, "scripts");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("plays a bundled default sound through the fixed script", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(provider.play({ soundId: "approval", volume: 80 })).resolves.toEqual({
      status: "delivered",
    });

    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0]!;
    expect(call.options.scriptPath).toBe(path.join(scriptsDir, "play-sound.ps1"));
    expect(call.options.args).toEqual([
      "-Path",
      path.join(DEFAULT_SOUNDS_DIR, "approval.wav"),
      "-Volume",
      "80",
    ]);
    expect(call.options.stdin).toBeUndefined();
  });

  it.each(["attention", "approval", "idle", "complete", "failure"])(
    "ships the bundled %s default",
    async (soundId) => {
      const runner = createFakeRunner();
      const provider = createWindowsSoundProvider({
        scriptsDir,
        runScript: runner.run,
      });

      await provider.play({ soundId, volume: 100 });

      expect(runner.calls[0]?.options.args[1]).toBe(
        path.join(DEFAULT_SOUNDS_DIR, `${soundId}.wav`),
      );
    },
  );

  it("passes a hostile custom path as one argv element, never as command text", async () => {
    const hostileName = 'evil; rm -rf ~ # $(x) `whoami` %TEMP%.wav';
    const hostilePath = path.join(tempDir, hostileName);
    await writeFile(hostilePath, Buffer.from("RIFF"));
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(
      provider.play({ soundId: "attention", volume: 50, filePath: hostilePath }),
    ).resolves.toEqual({ status: "delivered" });

    const call = runner.calls[0]!;
    expect(call.options.args).toEqual(["-Path", hostilePath, "-Volume", "50"]);
    expect(call.options.scriptPath).not.toContain(hostileName);
    expect(call.options.args.filter((arg) => arg.includes(hostileName))).toHaveLength(1);
    expect(call.options.args.some((arg) => arg.includes("powershell"))).toBe(false);
  });

  it("falls back to the default sound for a disallowed extension with a diagnostic", async () => {
    const soundPath = path.join(tempDir, "sound.txt");
    await writeFile(soundPath, "not audio");
    const diagnostics: string[] = [];
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    await expect(
      provider.play({ soundId: "complete", volume: 100, filePath: soundPath }),
    ).resolves.toEqual({ status: "delivered" });

    expect(diagnostics).toContain("invalid_extension");
    expect(runner.calls[0]?.options.args[1]).toBe(
      path.join(DEFAULT_SOUNDS_DIR, "complete.wav"),
    );
  });

  it("falls back for an oversized file", async () => {
    const soundPath = path.join(tempDir, "huge.wav");
    await writeFile(soundPath, Buffer.alloc(1));
    await truncate(soundPath, 5 * 1024 * 1024 + 1);
    const diagnostics: string[] = [];
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    await provider.play({ soundId: "failure", volume: 100, filePath: soundPath });

    expect(diagnostics).toContain("too_large");
    expect(runner.calls[0]?.options.args[1]).toBe(
      path.join(DEFAULT_SOUNDS_DIR, "failure.wav"),
    );
  });

  it("falls back for a missing or unreadable file", async () => {
    const diagnostics: string[] = [];
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    await provider.play({
      soundId: "idle",
      volume: 100,
      filePath: path.join(tempDir, "missing.wav"),
    });

    expect(diagnostics).toContain("not_readable");
    expect(runner.calls[0]?.options.args[1]).toBe(
      path.join(DEFAULT_SOUNDS_DIR, "idle.wav"),
    );
  });

  it("returns failed when fallback is disabled and the file is invalid", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
      fallbackOnError: false,
    });

    await expect(
      provider.play({
        soundId: "attention",
        volume: 100,
        filePath: path.join(tempDir, "missing.wav"),
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "invalid_sound" });
    expect(runner.calls).toHaveLength(0);
  });

  it("falls back for an unknown sound id with a diagnostic", async () => {
    const diagnostics: string[] = [];
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    await provider.play({ soundId: "../../escape", volume: 100 });

    expect(diagnostics).toContain("unknown_sound");
    expect(runner.calls[0]?.options.args[1]).toBe(
      path.join(DEFAULT_SOUNDS_DIR, "attention.wav"),
    );
  });

  it("clamps volume to 0..100 and keeps event volumes independent", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await provider.play({ soundId: "attention", volume: -20 });
    await provider.play({ soundId: "attention", volume: 250 });
    await provider.play({ soundId: "attention", volume: 37.6 });

    expect(runner.calls.map((call) => call.options.args[3])).toEqual([
      "0",
      "100",
      "38",
    ]);
  });

  it("maps a script failure to failed without throwing", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 2, stderr: "playback failed" }),
    );
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(
      provider.play({ soundId: "attention", volume: 100 }),
    ).resolves.toEqual({ status: "failed", errorCode: "sound_play_failed" });
  });

  it("maps a missing audio device to unavailable", async () => {
    const runner = createFakeRunner(() => scriptResult({ code: 3 }));
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(
      provider.play({ soundId: "attention", volume: 100 }),
    ).resolves.toEqual({ status: "unavailable", errorCode: "audio_unavailable" });
  });

  it("maps a timeout to failed", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, timedOut: true }),
    );
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(
      provider.play({ soundId: "attention", volume: 100 }),
    ).resolves.toEqual({ status: "failed", errorCode: "timeout" });
  });

  it("maps a spawn error to unavailable", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, spawnError: "spawn powershell.exe ENOENT" }),
    );
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: runner.run,
    });

    await expect(
      provider.play({ soundId: "attention", volume: 100 }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "powershell_unavailable",
    });
  });

  it("never throws when the injected runner rejects", async () => {
    const provider = createWindowsSoundProvider({
      scriptsDir,
      runScript: async () => {
        throw new Error("unexpected");
      },
    });

    await expect(
      provider.play({ soundId: "attention", volume: 100 }),
    ).resolves.toEqual({ status: "failed", errorCode: "provider_error" });
  });
});
