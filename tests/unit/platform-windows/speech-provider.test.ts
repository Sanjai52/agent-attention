import { describe, expect, it } from "vitest";
import { createWindowsSpeechProvider } from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "./fake-runner";

const SCRIPT_PATH = "C:\\app\\scripts\\speak.ps1";
const VOICES_SCRIPT_PATH = "C:\\app\\scripts\\list-voices.ps1";

describe("createWindowsSpeechProvider", () => {
  it("passes event text only through stdin and typed numeric arguments", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });
    const text = '"; rm -rf ~ # $(calc) `whoami` %TEMP% <script>&"';

    await expect(
      provider.speak({
        text,
        voiceId: null,
        volume: 70,
        rate: -3,
      }),
    ).resolves.toEqual({ status: "delivered" });

    const call = runner.calls[0]!;
    expect(call.options.scriptPath).toBe(SCRIPT_PATH);
    expect(call.options.stdin).toBe(text);
    expect(call.options.args).toEqual([
      "-Rate",
      "-3",
      "-Volume",
      "70",
    ]);
    expect(call.options.args.join(" ")).not.toContain(text);
    expect(call.options.args.some((arg) => arg.includes("calc"))).toBe(false);
  });

  it("accepts a 10k-character hostile payload through stdin", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });
    const text = `\u202E${"x".repeat(10_000)}\u0001"; Remove-Item -Recurse ~ #`;

    await provider.speak({ text, voiceId: null, volume: 100, rate: 0 });

    expect(runner.calls[0]?.options.stdin).toBe(text);
    expect(runner.calls[0]?.options.args).toEqual([
      "-Rate",
      "0",
      "-Volume",
      "100",
    ]);
  });

  it("passes a voice id as one argv element and clamps volume/rate", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });
    const hostileVoice = 'Microsoft David"; Remove-Item C:\\ #';

    await provider.speak({
      text: "Agent needs your approval.",
      voiceId: hostileVoice,
      volume: 900,
      rate: 99,
    });

    const args = runner.calls[0]!.options.args;
    expect(args).toEqual([
      "-Rate",
      "10",
      "-Volume",
      "100",
      "-Voice",
      hostileVoice,
    ]);
    expect(args.filter((arg) => arg === hostileVoice)).toHaveLength(1);
  });

  it("returns unavailable for empty text without spawning", async () => {
    const runner = createFakeRunner();
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({ text: "  \r\n\t", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({ status: "unavailable", errorCode: "empty_text" });
    expect(runner.calls).toHaveLength(0);
  });

  it("returns unavailable when the selected voice is not installed", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 5, stderr: "VOICE_NOT_FOUND: no such voice" }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({
        text: "hello",
        voiceId: "Microsoft No Such Voice",
        volume: 100,
        rate: 0,
      }),
    ).resolves.toEqual({ status: "unavailable", errorCode: "voice_not_found" });
  });

  it("returns unavailable when no voices are installed", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 4, stderr: "TTS_NO_VOICES" }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({ text: "hello", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({ status: "unavailable", errorCode: "tts_unavailable" });
  });

  it("maps synthesis failure to failed without affecting other channels", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: 2, stderr: "synthesis exploded" }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({ text: "hello", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({ status: "failed", errorCode: "tts_failed" });
  });

  it("maps a timeout to failed and kills the child via the runner", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, timedOut: true }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({ text: "hello", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({ status: "failed", errorCode: "timeout" });
  });

  it("maps a spawn error to unavailable", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({ code: -1, spawnError: "spawn powershell.exe ENOENT" }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(
      provider.speak({ text: "hello", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({
      status: "unavailable",
      errorCode: "powershell_unavailable",
    });
  });

  it("stop() aborts the in-flight utterance", async () => {
    let receivedSignal: AbortSignal | undefined;
    const runner = createFakeRunner(
      (options) =>
        new Promise((resolve) => {
          receivedSignal = options.signal;
          options.signal?.addEventListener(
            "abort",
            () => resolve(scriptResult({ code: -1, aborted: true })),
            { once: true },
          );
        }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: runner.run,
    });

    const speaking = provider.speak({
      text: "a long announcement",
      voiceId: null,
      volume: 100,
      rate: 0,
    });
    expect(receivedSignal?.aborted).toBe(false);

    provider.stop();

    await expect(speaking).resolves.toEqual({
      status: "failed",
      errorCode: "cancelled",
    });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("never throws when the runner rejects", async () => {
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      runScript: async () => {
        throw new Error("unexpected");
      },
    });

    await expect(
      provider.speak({ text: "hello", voiceId: null, volume: 100, rate: 0 }),
    ).resolves.toEqual({ status: "failed", errorCode: "provider_error" });
  });

  it("enumerates installed voices through a separate fixed script", async () => {
    const runner = createFakeRunner(() =>
      scriptResult({
        stdout: JSON.stringify({
          count: 2,
          voices: [
            {
              name: "Microsoft David Desktop",
              culture: "en-US",
              gender: "Male",
              age: "Adult",
              enabled: true,
            },
            {
              name: "Microsoft Zira Desktop",
              culture: "en-US",
              gender: "Female",
              age: "Adult",
              enabled: false,
            },
          ],
        }),
      }),
    );
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      voicesScriptPath: VOICES_SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.listVoices()).resolves.toEqual([
      {
        name: "Microsoft David Desktop",
        culture: "en-US",
        gender: "Male",
        age: "Adult",
        enabled: true,
      },
      {
        name: "Microsoft Zira Desktop",
        culture: "en-US",
        gender: "Female",
        age: "Adult",
        enabled: false,
      },
    ]);
    expect(runner.calls[0]?.options.scriptPath).toBe(VOICES_SCRIPT_PATH);
    expect(runner.calls[0]?.options.args).toEqual([]);
  });

  it("returns an empty voice list when enumeration fails", async () => {
    const runner = createFakeRunner(() => scriptResult({ code: 1 }));
    const provider = createWindowsSpeechProvider({
      scriptPath: SCRIPT_PATH,
      voicesScriptPath: VOICES_SCRIPT_PATH,
      runScript: runner.run,
    });

    await expect(provider.listVoices()).resolves.toEqual([]);
  });
});
