/**
 * Bounded, sequential audio queue (PRD.md F12-R1, F12-R2, AC-F12-01).
 *
 * The queue never plays two entries at once. Entries are ordered by descending
 * priority (D-10: approval > input > failed > turn_ended > completed) with
 * stable FIFO order inside one priority. The in-flight entry is not counted
 * against `maxQueueLength`; instead, a newcomer that finds the queue full
 * either replaces the queued lowest-priority entry or is dropped itself.
 *
 * Dropping is an audio-only concern: the caller (dispatch) still records the
 * event and the desktop toast (F12-R2).
 */

import type { AgentEventType } from "@agent-attention/contract";
import type { ProviderResult, ProviderStatus } from "./providers";

export interface AudioEntry {
  eventId: string;
  eventType: AgentEventType;
  kind: "sound" | "voice";
  priority: number;
  payload: unknown;
}

export type AudioQueueDropReason = "queue_overflow_lowest_priority";

export type AudioQueueResult =
  | {
      entry: AudioEntry;
      status: ProviderStatus;
      errorCode?: string;
    }
  | {
      entry: AudioEntry;
      status: "dropped";
      reason: AudioQueueDropReason;
    };

export type AudioQueueEnqueueResult = "queued" | "dropped";

export interface AudioQueueOptions {
  maxQueueLength: number;
  play: (entry: AudioEntry) => Promise<ProviderResult>;
  /** Called once per played or dropped entry. */
  onResult?: (result: AudioQueueResult) => void;
}

export interface AudioQueue {
  /**
   * `dropped` means this entry will not play; the low-priority queued entry it
   * evicted is reported through `onResult` with
   * `reason: "queue_overflow_lowest_priority"`.
   */
  enqueue(entry: AudioEntry): AudioQueueEnqueueResult;
  /** Number of queued entries, excluding the one currently playing. */
  readonly length: number;
  /** Resolves when the queue is empty and no entry is playing. */
  whenIdle(): Promise<void>;
  /** Subscribe to played/dropped results. Returns an unsubscribe function. */
  onResult(listener: (result: AudioQueueResult) => void): () => void;
}

function normalizeMaxQueueLength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Insert before the first strictly lower-priority entry, preserving FIFO ties. */
function insertByPriority(queue: AudioEntry[], entry: AudioEntry): void {
  const index = queue.findIndex((queued) => queued.priority < entry.priority);
  if (index === -1) {
    queue.push(entry);
  } else {
    queue.splice(index, 0, entry);
  }
}

export function createAudioQueue(options: AudioQueueOptions): AudioQueue {
  const maxQueueLength = normalizeMaxQueueLength(options.maxQueueLength);
  const queue: AudioEntry[] = [];
  const listeners = new Set<(result: AudioQueueResult) => void>();
  let playing = false;
  let pumpScheduled = false;
  let idleWaiters: Array<() => void> = [];

  function emit(result: AudioQueueResult): void {
    const callbacks = [...(options.onResult === undefined ? [] : [options.onResult]), ...listeners];

    for (const callback of callbacks) {
      try {
        callback(result);
      } catch {
        // Observer failures must never stall audio delivery.
      }
    }
  }

  function resolveIdleWaiters(): void {
    if (playing || queue.length > 0) {
      return;
    }

    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  function schedulePump(): void {
    if (pumpScheduled || playing) {
      return;
    }

    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      void pump();
    });
  }

  async function pump(): Promise<void> {
    if (playing) {
      return;
    }

    const entry = queue.shift();
    if (entry === undefined) {
      resolveIdleWaiters();
      return;
    }

    playing = true;
    let result: ProviderResult;
    try {
      result = await options.play(entry);
    } catch {
      result = { status: "failed", errorCode: "provider_rejected" };
    }
    playing = false;

    emit({
      entry,
      status: result.status,
      ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    });

    if (queue.length > 0) {
      schedulePump();
    } else {
      resolveIdleWaiters();
    }
  }

  function enqueue(entry: AudioEntry): AudioQueueEnqueueResult {
    if (queue.length >= maxQueueLength) {
      const lowest = queue.at(-1);

      if (lowest === undefined || entry.priority <= lowest.priority) {
        emit({ entry, status: "dropped", reason: "queue_overflow_lowest_priority" });
        return "dropped";
      }

      queue.pop();
      emit({
        entry: lowest,
        status: "dropped",
        reason: "queue_overflow_lowest_priority",
      });
    }

    insertByPriority(queue, entry);
    schedulePump();
    return "queued";
  }

  function whenIdle(): Promise<void> {
    if (!playing && queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  }

  function onResult(listener: (result: AudioQueueResult) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    enqueue,
    get length() {
      return queue.length;
    },
    whenIdle,
    onResult,
  };
}
