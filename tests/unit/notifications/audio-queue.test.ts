import type { AgentEventType } from "@agent-attention/contract";
import {
  createAudioQueue,
  type AudioEntry,
  type AudioQueueResult,
  type ProviderResult,
} from "@agent-attention/notifications";
import { describe, expect, it, vi } from "vitest";

function makeEntry(
  eventId: string,
  eventType: AgentEventType,
  priority: number,
  kind: "sound" | "voice" = "sound",
): AudioEntry {
  return {
    eventId,
    eventType,
    kind,
    priority,
    payload: { soundId: "attention", volume: 35 },
  };
}

const delivered = async (): Promise<ProviderResult> => ({ status: "delivered" });

describe("createAudioQueue", () => {
  it("plays entries strictly sequentially (AC-F12-01)", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const play = vi.fn((entry: AudioEntry) => {
      order.push(entry.eventId);
      active += 1;
      maxActive = Math.max(maxActive, active);

      return new Promise<ProviderResult>((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve({ status: "delivered" });
        });
      });
    });

    const queue = createAudioQueue({ maxQueueLength: 3, play });
    expect(queue.enqueue(makeEntry("low", "agent.completed", 1))).toBe("queued");
    expect(queue.enqueue(makeEntry("high", "agent.turn_ended", 2))).toBe("queued");

    await vi.waitFor(() => expect(order).toEqual(["high"]));
    expect(maxActive).toBe(1);

    releases[0]?.();
    await vi.waitFor(() => expect(order).toEqual(["high", "low"]));

    releases[1]?.();
    await queue.whenIdle();
    expect(maxActive).toBe(1);
    expect(queue.length).toBe(0);
  });

  it("plays a later higher-priority entry before an already queued lower one (D-10)", async () => {
    const order: string[] = [];
    const queue = createAudioQueue({
      maxQueueLength: 5,
      play: async (entry) => {
        order.push(entry.eventId);
        return { status: "delivered" };
      },
    });

    queue.enqueue(makeEntry("completion", "agent.completed", 1));
    queue.enqueue(makeEntry("approval", "agent.needs_approval", 5));

    await queue.whenIdle();
    expect(order).toEqual(["approval", "completion"]);
  });

  it("keeps FIFO order within one priority (AC-F12-01)", async () => {
    const order: string[] = [];
    const queue = createAudioQueue({
      maxQueueLength: 5,
      play: async (entry) => {
        order.push(entry.eventId);
        return { status: "delivered" };
      },
    });

    queue.enqueue(makeEntry("completed-1", "agent.completed", 1));
    queue.enqueue(makeEntry("completed-2", "agent.completed", 1));
    queue.enqueue(makeEntry("completed-3", "agent.completed", 1));

    await queue.whenIdle();
    expect(order).toEqual(["completed-1", "completed-2", "completed-3"]);
  });

  it("drops a lower-priority newcomer when the queue is full (F12-R2)", async () => {
    const results: AudioQueueResult[] = [];
    const played: string[] = [];
    const queue = createAudioQueue({
      maxQueueLength: 3,
      play: async (entry) => {
        played.push(entry.eventId);
        return { status: "delivered" };
      },
      onResult: (result) => results.push(result),
    });

    queue.enqueue(makeEntry("approval", "agent.needs_approval", 5));
    queue.enqueue(makeEntry("input", "agent.needs_input", 4));
    queue.enqueue(makeEntry("failed", "agent.failed", 3));

    const extra = makeEntry("completed", "agent.completed", 1);
    expect(queue.enqueue(extra)).toBe("dropped");

    expect(results.at(-1)).toEqual({
      entry: extra,
      status: "dropped",
      reason: "queue_overflow_lowest_priority",
    });

    await queue.whenIdle();
    expect(played).toEqual(["approval", "input", "failed"]);
  });

  it("evicts and reports the lowest-priority entry for a higher-priority newcomer", async () => {
    const results: AudioQueueResult[] = [];
    const played: string[] = [];
    const queue = createAudioQueue({
      maxQueueLength: 3,
      play: async (entry) => {
        played.push(entry.eventId);
        return { status: "delivered" };
      },
      onResult: (result) => results.push(result),
    });

    queue.enqueue(makeEntry("approval", "agent.needs_approval", 5));
    queue.enqueue(makeEntry("input", "agent.needs_input", 4));
    const evicted = makeEntry("turn-ended", "agent.turn_ended", 2);
    queue.enqueue(evicted);
    queue.enqueue(makeEntry("failed", "agent.failed", 3));

    expect(results).toContainEqual({
      entry: evicted,
      status: "dropped",
      reason: "queue_overflow_lowest_priority",
    });

    await queue.whenIdle();
    expect(played).toEqual(["approval", "input", "failed"]);
  });

  it("counts the in-flight entry outside maxQueueLength", async () => {
    const results: AudioQueueResult[] = [];
    const releases: Array<() => void> = [];
    const queue = createAudioQueue({
      maxQueueLength: 1,
      play: (_entry) =>
        new Promise<ProviderResult>((resolve) => {
          releases.push(() => resolve({ status: "delivered" }));
        }),
      onResult: (result) => results.push(result),
    });

    queue.enqueue(makeEntry("playing", "agent.needs_approval", 5));
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    queue.enqueue(makeEntry("queued", "agent.needs_input", 4));
    expect(queue.length).toBe(1);

    const extra = makeEntry("overflow", "agent.completed", 1);
    expect(queue.enqueue(extra)).toBe("dropped");
    expect(results.at(-1)?.entry).toBe(extra);

    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.();
    await queue.whenIdle();
    expect(queue.length).toBe(0);
  });

  it("reports a play rejection as failed and keeps draining", async () => {
    const results: AudioQueueResult[] = [];
    const play = vi
      .fn<(entry: AudioEntry) => Promise<ProviderResult>>()
      .mockRejectedValueOnce(new Error("audio device gone"))
      .mockResolvedValueOnce({ status: "delivered" });

    const queue = createAudioQueue({
      maxQueueLength: 3,
      play,
      onResult: (result) => results.push(result),
    });

    queue.enqueue(makeEntry("first", "agent.needs_approval", 5));
    queue.enqueue(makeEntry("second", "agent.completed", 1));
    await queue.whenIdle();

    expect(play).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      entry: expect.objectContaining({ eventId: "first" }),
      status: "failed",
    });
    expect(results[0]?.errorCode).toBe("provider_rejected");
    expect(results[1]).toMatchObject({
      entry: expect.objectContaining({ eventId: "second" }),
      status: "delivered",
    });
  });

  it("passes through an unavailable provider result", async () => {
    const results: AudioQueueResult[] = [];
    const queue = createAudioQueue({
      maxQueueLength: 3,
      play: async () => ({ status: "unavailable", errorCode: "no_audio_device" }),
      onResult: (result) => results.push(result),
    });

    queue.enqueue(makeEntry("voice", "agent.needs_input", 4, "voice"));
    await queue.whenIdle();

    expect(results).toEqual([
      {
        entry: expect.objectContaining({ eventId: "voice", kind: "voice" }),
        status: "unavailable",
        errorCode: "no_audio_device",
      },
    ]);
  });

  it("supports subscribing to results after creation", async () => {
    const results: AudioQueueResult[] = [];
    const queue = createAudioQueue({ maxQueueLength: 3, play: delivered });
    const unsubscribe = queue.onResult((result) => results.push(result));

    queue.enqueue(makeEntry("one", "agent.completed", 1));
    await queue.whenIdle();
    unsubscribe();
    queue.enqueue(makeEntry("two", "agent.completed", 1));
    await queue.whenIdle();

    expect(results.map((result) => result.entry.eventId)).toEqual(["one"]);
  });

  it("drops every entry when the queue is configured with zero capacity", async () => {
    const results: AudioQueueResult[] = [];
    const play = vi.fn(delivered);
    const queue = createAudioQueue({
      maxQueueLength: 0,
      play,
      onResult: (result) => results.push(result),
    });

    expect(queue.enqueue(makeEntry("one", "agent.completed", 1))).toBe("dropped");
    await queue.whenIdle();

    expect(play).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "dropped" });
  });
});
