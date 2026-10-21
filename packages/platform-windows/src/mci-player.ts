/**
 * In-process WinMM MCI playback (Q-05 primary route).
 *
 * koffi is loaded dynamically so a missing/incompatible prebuilt binary or a
 * non-Windows test host degrades to the fixed PowerShell fallback instead of
 * crashing the Notification Host. Calls are serialized by the audio queue; the
 * MCI `play` command starts asynchronously, and this player waits for the
 * reported clip length before releasing the alias so consecutive sounds cannot
 * overlap.
 */

import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import type { ProviderResult } from "./provider-types";

export interface MciBackend {
  open(filePath: string, type: string, alias: string): { code: number; message: string };
  setVolume(alias: string, volume: number): number;
  play(alias: string): number;
  length(alias: string): number;
  close(alias: string): void;
}

export interface MciPlayer {
  play(filePath: string, volume: number): Promise<ProviderResult>;
}

type KoffiCallable = (...args: Array<string | number | Buffer | null>) => number;

interface KoffiLibrary {
  func(signature: string): KoffiCallable;
}

interface KoffiApi {
  load(path: string): KoffiLibrary;
}

function mciErrorResult(code: number): ProviderResult {
  // 277 = MCIERR_DEVICE_OPEN, 290 = MCIERR_DEVICE_NOT_INSTALLED.
  if (code === 277 || code === 290) {
    return { status: "unavailable", errorCode: "audio_device_unavailable" };
  }
  // 296 = invalid wave file, 304 = invalid filename.
  if (code === 296 || code === 304) {
    return { status: "failed", errorCode: "invalid_sound_file" };
  }
  return { status: "failed", errorCode: `mci_${code}` };
}

export function createMciPlayer(backend: MciBackend): MciPlayer {
  let counter = 0;

  return {
    async play(filePath, volume): Promise<ProviderResult> {
      const alias = `agentattention${++counter}`;
      const extension = path.extname(filePath).toLowerCase();
      const type = extension === ".mp3" ? "mpegvideo" : "waveaudio";
      const opened = backend.open(filePath, type, alias);
      if (opened.code !== 0) {
        return mciErrorResult(opened.code);
      }

      let lengthMs = 0;
      try {
        lengthMs = backend.length(alias);
        if (volume > 0) {
          const clamped = Math.max(0, Math.min(100, Math.round(volume)));
          backend.setVolume(alias, clamped);
          const code = backend.play(alias);
          if (code !== 0) {
            return mciErrorResult(code);
          }
        }
      } finally {
        // Keep the queue serialized for the audible duration. MCI `play`
        // without `wait` returns immediately; this delay is not a render loop.
        if (volume > 0 && lengthMs > 0) {
          await delay(Math.min(lengthMs, 30_000));
        }
        backend.close(alias);
      }

      return { status: "delivered" };
    },
  };
}

export async function loadKoffiMciBackend(): Promise<MciBackend | undefined> {
  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    const imported = (await import("koffi")) as unknown as KoffiApi & {
      default?: KoffiApi;
    };
    const koffi = imported.default ?? imported;
    const winmm = koffi.load("winmm.dll");
    const send = winmm.func(
      "uint32 __stdcall mciSendStringW(str16 cmd, void *ret, uint32 retLen, void *hwnd)",
    );
    const getError = winmm.func(
      "int __stdcall mciGetErrorStringW(uint32 err, _Out_ str16 buf, uint32 len)",
    );

    const call = (command: string): { code: number; message: string } => {
      const buffer = Buffer.alloc(512);
      const code = send(command, buffer, buffer.length, null);
      if (code === 0) {
        return { code, message: "" };
      }
      const errorBuffer = Buffer.alloc(512);
      getError(code, errorBuffer, 256);
      return {
        code,
        message: errorBuffer.toString("utf16le").replace(/\0.*$/s, ""),
      };
    };

    return {
      open(filePath, type, alias) {
        return call(`open "${filePath}" type ${type} alias ${alias}`);
      },
      setVolume(alias, volume) {
        return call(`setaudio ${alias} volume to ${volume * 10}`).code;
      },
      play(alias) {
        return call(`play ${alias}`).code;
      },
      length(alias) {
        const result = call(`status ${alias} length`);
        if (result.code !== 0) {
          return 0;
        }
        const parsed = Number.parseInt(result.message, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      },
      close(alias) {
        call(`close ${alias}`);
      },
    };
  } catch {
    return undefined;
  }
}

export async function createKoffiMciPlayer(): Promise<MciPlayer | undefined> {
  const backend = await loadKoffiMciBackend();
  return backend === undefined ? undefined : createMciPlayer(backend);
}
