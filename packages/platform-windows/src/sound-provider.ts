import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createKoffiMciPlayer, type MciPlayer } from "./mci-player";
import { runFixedScript, type RunFixedScript } from "./powershell";
import { resolvePlatformResource } from "./resources";
import type { ProviderResult, SoundProvider, SoundRequest } from "./provider-types";

export const BUNDLED_SOUND_IDS = [
  "attention",
  "approval",
  "idle",
  "complete",
  "failure",
] as const;

export type BundledSoundId = (typeof BUNDLED_SOUND_IDS)[number];

const FALLBACK_SOUND_ID: BundledSoundId = "attention";
const ALLOWED_EXTENSIONS = new Set([".wav", ".mp3"]);
export const MAX_SOUND_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_SOUNDS_DIR = resolvePlatformResource("assets/sounds");

const BUNDLED = new Set<string>(BUNDLED_SOUND_IDS);

export type SoundDiagnosticCode =
  | "invalid_extension"
  | "too_large"
  | "not_readable"
  | "unknown_sound";

export interface SoundDiagnostic {
  code: SoundDiagnosticCode;
  message: string;
}

export interface WindowsSoundProviderOptions {
  /** Directory containing the committed `play-sound.ps1`. */
  scriptsDir: string;
  /** Defaults to the packaged `assets/sounds` directory. */
  soundsDir?: string;
  /** F4-R11 fallback. Set false only to surface invalid custom files. */
  fallbackOnError?: boolean;
  timeoutMs?: number;
  runScript?: RunFixedScript;
  /** Override the primary in-process MCI player; null forces the script. */
  mci?: MciPlayer | null;
  onDiagnostic?: (diagnostic: SoundDiagnostic) => void;
}

interface ResolvedSound {
  filePath: string;
  invalid: boolean;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 100;
  return Math.max(0, Math.min(100, Math.round(volume)));
}

function bundledPath(soundsDir: string, soundId: BundledSoundId): string {
  return path.join(soundsDir, `${soundId}.wav`);
}

export function createWindowsSoundProvider(
  options: WindowsSoundProviderOptions,
): SoundProvider {
  const soundsDir = options.soundsDir ?? DEFAULT_SOUNDS_DIR;
  const fallbackOnError = options.fallbackOnError ?? true;
  const runScript = options.runScript ?? runFixedScript;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const scriptPath = path.join(options.scriptsDir, "play-sound.ps1");

  let mciPromise: Promise<MciPlayer | undefined> | undefined;
  const resolveMci = (): Promise<MciPlayer | undefined> => {
    if (options.mci !== undefined) {
      return Promise.resolve(options.mci ?? undefined);
    }
    // An injected script runner is the test/seam path; do not touch the native
    // player behind its back.
    if (options.runScript !== undefined) {
      return Promise.resolve(undefined);
    }
    mciPromise ??= createKoffiMciPlayer();
    return mciPromise;
  };

  const diagnose = (code: SoundDiagnosticCode, message: string): void => {
    try {
      options.onDiagnostic?.({ code, message });
    } catch {
      // Diagnostics must never break playback.
    }
  };

  const resolve = async (request: SoundRequest): Promise<ResolvedSound> => {
    const requestedId = request.soundId.toLowerCase();
    const fallbackId = BUNDLED.has(requestedId)
      ? (requestedId as BundledSoundId)
      : FALLBACK_SOUND_ID;

    if (request.filePath !== undefined && request.filePath.trim() !== "") {
      const candidate = path.resolve(request.filePath);
      const extension = path.extname(candidate).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        diagnose(
          "invalid_extension",
          `Custom sound extension "${extension || "(none)"}" is not allowed; using ${fallbackId}.`,
        );
        return { filePath: bundledPath(soundsDir, fallbackId), invalid: true };
      }

      try {
        const info = await stat(candidate);
        if (!info.isFile()) {
          diagnose("not_readable", "Custom sound path is not a file; using default.");
          return { filePath: bundledPath(soundsDir, fallbackId), invalid: true };
        }
        if (info.size > MAX_SOUND_FILE_BYTES) {
          diagnose(
            "too_large",
            `Custom sound exceeds ${MAX_SOUND_FILE_BYTES} bytes; using ${fallbackId}.`,
          );
          return { filePath: bundledPath(soundsDir, fallbackId), invalid: true };
        }
        await access(candidate, constants.R_OK);
      } catch {
        diagnose("not_readable", "Custom sound file is missing or unreadable; using default.");
        return { filePath: bundledPath(soundsDir, fallbackId), invalid: true };
      }

      return { filePath: candidate, invalid: false };
    }

    if (!BUNDLED.has(requestedId)) {
      diagnose(
        "unknown_sound",
        `Unknown sound id "${request.soundId}"; using ${FALLBACK_SOUND_ID}.`,
      );
      return { filePath: bundledPath(soundsDir, FALLBACK_SOUND_ID), invalid: true };
    }

    return { filePath: bundledPath(soundsDir, requestedId as BundledSoundId), invalid: false };
  };

  return {
    async play(request: SoundRequest): Promise<ProviderResult> {
      const resolved = await resolve(request);
      if (resolved.invalid && !fallbackOnError) {
        return { status: "failed", errorCode: "invalid_sound" };
      }

      const mci = await resolveMci();
      if (mci !== undefined) {
        try {
          const primary = await mci.play(resolved.filePath, clampVolume(request.volume));
          if (primary.status === "delivered") {
            return primary;
          }
        } catch {
          // Fall through to the fixed PowerShell route.
        }
      }

      let result;
      try {
        result = await runScript({
          scriptPath,
          args: ["-Path", resolved.filePath, "-Volume", String(clampVolume(request.volume))],
          timeoutMs,
        });
      } catch {
        return { status: "failed", errorCode: "provider_error" };
      }

      if (result.timedOut) return { status: "failed", errorCode: "timeout" };
      if (result.aborted) return { status: "failed", errorCode: "cancelled" };
      if (result.spawnError !== undefined) {
        return { status: "unavailable", errorCode: "powershell_unavailable" };
      }
      if (result.code === 3) {
        return { status: "unavailable", errorCode: "audio_unavailable" };
      }
      if (result.code !== 0) {
        return { status: "failed", errorCode: "sound_play_failed" };
      }
      return { status: "delivered" };
    },
  };
}
