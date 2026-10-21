import {
  runFixedScript,
  type FixedScriptResult,
  type RunFixedScript,
} from "./powershell";
import type { ProviderResult, SpeechProvider, SpeechRequest } from "./provider-types";

export interface VoiceInfo {
  name: string;
  culture: string;
  gender: string;
  age: string;
  enabled: boolean;
}

export interface WindowsSpeechProvider extends SpeechProvider {
  /** Cancel the current utterance by terminating the fixed script. */
  stop(): void;
  /** Installed SAPI voices for `doctor`/config; empty when unavailable. */
  listVoices(): Promise<VoiceInfo[]>;
}

export interface WindowsSpeechProviderOptions {
  /** Absolute path to the committed `speak.ps1`. */
  scriptPath: string;
  /** Absolute path to the committed `list-voices.ps1`. */
  voicesScriptPath?: string;
  timeoutMs?: number;
  runScript?: RunFixedScript;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 100;
  return Math.max(0, Math.min(100, Math.round(volume)));
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.max(-10, Math.min(10, Math.round(rate)));
}

function parseVoices(stdout: string): VoiceInfo[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const voices = (parsed as { voices?: unknown }).voices;
  if (!Array.isArray(voices)) return [];

  const result: VoiceInfo[] = [];
  for (const entry of voices) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name === "") continue;
    result.push({
      name: record.name,
      culture: typeof record.culture === "string" ? record.culture : "",
      gender: typeof record.gender === "string" ? record.gender : "",
      age: typeof record.age === "string" ? record.age : "",
      enabled: record.enabled !== false,
    });
  }
  return result;
}

export function createWindowsSpeechProvider(
  options: WindowsSpeechProviderOptions,
): WindowsSpeechProvider {
  const runScript = options.runScript ?? runFixedScript;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const active = new Set<AbortController>();

  return {
    async speak(request: SpeechRequest): Promise<ProviderResult> {
      if (request.text.trim() === "") {
        return { status: "unavailable", errorCode: "empty_text" };
      }

      const volume = clampVolume(request.volume);
      const rate = clampRate(request.rate);
      const args = ["-Rate", String(rate), "-Volume", String(volume)];
      if (request.voiceId !== null && request.voiceId !== "") {
        args.push("-Voice", request.voiceId);
      }

      const controller = new AbortController();
      active.add(controller);
      let result: FixedScriptResult;
      try {
        // Event text is stdin only. It never appears in argv or a command line.
        result = await runScript({
          scriptPath: options.scriptPath,
          args,
          stdin: request.text,
          timeoutMs,
          signal: controller.signal,
        });
      } catch {
        return { status: "failed", errorCode: "provider_error" };
      } finally {
        active.delete(controller);
      }

      if (result.aborted) return { status: "failed", errorCode: "cancelled" };
      if (result.timedOut) return { status: "failed", errorCode: "timeout" };
      if (result.spawnError !== undefined) {
        return { status: "unavailable", errorCode: "powershell_unavailable" };
      }
      if (result.code === 4) {
        return { status: "unavailable", errorCode: "tts_unavailable" };
      }
      if (result.code === 5) {
        return { status: "unavailable", errorCode: "voice_not_found" };
      }
      if (result.code !== 0) {
        return { status: "failed", errorCode: "tts_failed" };
      }
      return { status: "delivered" };
    },

    stop(): void {
      for (const controller of active) controller.abort();
      active.clear();
    },

    async listVoices(): Promise<VoiceInfo[]> {
      if (options.voicesScriptPath === undefined) return [];
      try {
        const result = await runScript({
          scriptPath: options.voicesScriptPath,
          args: [],
          timeoutMs: 15_000,
        });
        if (result.code !== 0 || result.timedOut || result.aborted) return [];
        return parseVoices(result.stdout);
      } catch {
        return [];
      }
    },
  };
}
