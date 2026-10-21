/**
 * One registry for every host-owned timer (PRD.md §9.2, Task 2.5).
 *
 * Pipeline timers (`grace`, `stale`, `reminder`) and the host's own idle-exit
 * timer share the registry so `dispose()` is the single leak-proof shutdown
 * path. A timer is identified by `(kind, sessionKey, requestId)`; arming the
 * same identity replaces the previous timer rather than stacking a duplicate.
 */

import type { TimerInstruction, TimerKind } from "@agent-attention/core";

export type HostTimerKind = TimerKind | "host_exit";

export interface HostTimerInstruction extends Omit<TimerInstruction, "kind"> {
  kind: HostTimerKind;
}

export interface TimerRegistryOptions {
  onFire: (instruction: HostTimerInstruction) => void | Promise<void>;
  nowMs?: () => number;
  /** setTimeout's maximum delay; longer timers are re-armed in chunks. */
  maxTimeoutMs?: number;
}

export interface TimerRegistry {
  arm(instruction: HostTimerInstruction): void;
  cancel(kind: HostTimerKind, sessionKey: string): void;
  cancelAll(kind?: HostTimerKind): void;
  dispose(): void;
  pending(): HostTimerInstruction[];
  readonly size: number;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

function timerKey(instruction: HostTimerInstruction): string {
  return `${instruction.kind}\u0000${instruction.sessionKey}\u0000${instruction.requestId ?? ""}`;
}

export function createTimerRegistry(options: TimerRegistryOptions): TimerRegistry {
  const nowMs = options.nowMs ?? (() => Date.now());
  const maxTimeoutMs = Math.min(options.maxTimeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const timers = new Map<
    string,
    { instruction: HostTimerInstruction; handle: NodeJS.Timeout }
  >();

  const schedule = (instruction: HostTimerInstruction, key: string): void => {
    const dueMs = Date.parse(instruction.dueAt);
    const delay = Number.isFinite(dueMs) ? Math.max(0, dueMs - nowMs()) : 0;
    const wait = Math.min(delay, maxTimeoutMs);

    const handle = setTimeout(() => {
      timers.delete(key);
      // A very long timer is chunked; re-arm until the real due time arrives.
      if (delay > wait) {
        schedule(instruction, key);
        return;
      }
      void Promise.resolve(options.onFire(instruction)).catch(() => {
        // A timer callback must never crash the host.
      });
    }, wait);
    handle.unref();
    timers.set(key, { instruction, handle });
  };

  return {
    arm(instruction) {
      const key = timerKey(instruction);
      const existing = timers.get(key);
      if (existing !== undefined) {
        clearTimeout(existing.handle);
        timers.delete(key);
      }
      schedule(instruction, key);
    },

    cancel(kind, sessionKey) {
      const prefix = `${kind}\u0000${sessionKey}\u0000`;
      for (const [key, timer] of timers) {
        if (key.startsWith(prefix)) {
          clearTimeout(timer.handle);
          timers.delete(key);
        }
      }
    },

    cancelAll(kind) {
      for (const [key, timer] of timers) {
        if (kind === undefined || timer.instruction.kind === kind) {
          clearTimeout(timer.handle);
          timers.delete(key);
        }
      }
    },

    dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer.handle);
      }
      timers.clear();
    },

    pending() {
      return [...timers.values()].map((timer) => ({ ...timer.instruction }));
    },

    get size() {
      return timers.size;
    },
  };
}
