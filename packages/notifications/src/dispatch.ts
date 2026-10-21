/**
 * Dispatch orchestration and delivery records (PRD.md §14.2 steps 7–8, §9.4,
 * F9–F12, Task 2.9).
 *
 * The core has already persisted the event and decided, per channel, whether
 * to dispatch or suppress. This module:
 *
 * - records every planned channel exactly once (idempotence by
 *   `(eventId, channel)` within one dispatch call);
 * - runs channels independently, so one provider failure never blocks another;
 * - routes sound and voice through the sequential audio queue;
 * - calls the desktop provider directly;
 * - converts provider rejections into `failed` records and never throws them.
 *
 * `suppressed` plans are recorded with their reason and invoke no provider.
 */

import { defaultConfig } from "@agent-attention/contract";
import type { AgentAttentionConfig, AgentEventType } from "@agent-attention/contract";
import type { Channel, PlannedNotification } from "@agent-attention/core";
import type { AudioEntry, AudioQueue, AudioQueueResult } from "./audio-queue";
import type { ProviderResult, ProviderSet, SoundRequest, SpeechRequest } from "./providers";

export type DeliveryStatus = "delivered" | "failed" | "unavailable" | "suppressed";

/** One row for `event_deliveries` (PRD §15.1). */
export interface DeliveryRecord {
  eventId: string;
  channel: Channel;
  status: DeliveryStatus;
  /** Set for suppressed deliveries; `queue_overflow_lowest_priority` for audio overflow. */
  reason?: string;
  errorCode?: string;
  attemptedAt: string;
}

export interface DispatchDependencies {
  providers: ProviderSet;
  queue: AudioQueue;
  recordDelivery(record: DeliveryRecord): void;
  now(): string;
  /**
   * Effective per-event sound settings from the host's resolved config.
   * Defaults to the PRD §8.3 defaults for the event class.
   */
  resolveSound?(planned: PlannedNotification): SoundRequest;
  /** Effective voice settings from the host's resolved config. */
  resolveSpeech?(planned: PlannedNotification): SpeechRequest;
}

/** Route an audio entry to the matching provider (for `createAudioQueue`). */
export function providerAudioPlayer(
  providers: ProviderSet,
): (entry: AudioEntry) => Promise<ProviderResult> {
  return (entry) => {
    if (entry.kind === "sound") {
      return providers.sound.play(entry.payload as SoundRequest);
    }

    return providers.voice.speak(entry.payload as SpeechRequest);
  };
}

const EVENT_CONFIG_KEYS: Readonly<
  Partial<Record<AgentEventType, keyof AgentAttentionConfig["events"]>>
> = {
  "agent.needs_input": "needsInput",
  "agent.needs_approval": "needsApproval",
  "agent.turn_ended": "turnEnded",
  "agent.completed": "completed",
  "agent.failed": "failed",
};

function defaultSoundRequest(planned: PlannedNotification): SoundRequest {
  const configKey = EVENT_CONFIG_KEYS[planned.eventType];
  const eventConfig = configKey === undefined ? undefined : defaultConfig.events[configKey];

  return {
    soundId: eventConfig?.sound.soundId ?? "attention",
    volume: eventConfig?.sound.volume ?? 35,
  };
}

function defaultSpeechRequest(planned: PlannedNotification): SpeechRequest {
  return {
    text: planned.rendered?.speech ?? "",
    voiceId: defaultConfig.voice.voiceId,
    volume: defaultConfig.voice.volume,
    rate: defaultConfig.voice.rate,
  };
}

function failedRecord(
  planned: PlannedNotification,
  channel: Channel,
  attemptedAt: string,
  errorCode: string,
  reason?: string,
): DeliveryRecord {
  return {
    eventId: planned.eventId,
    channel,
    status: "failed",
    ...(reason === undefined ? {} : { reason }),
    errorCode,
    attemptedAt,
  };
}

function providerRecord(
  planned: PlannedNotification,
  channel: Channel,
  attemptedAt: string,
  result: ProviderResult,
): DeliveryRecord {
  return {
    eventId: planned.eventId,
    channel,
    status: result.status,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    attemptedAt,
  };
}

function audioRecord(
  planned: PlannedNotification,
  channel: "sound" | "voice",
  attemptedAt: string,
  result: AudioQueueResult,
): DeliveryRecord {
  if (result.status === "dropped") {
    return failedRecord(planned, channel, attemptedAt, result.reason, result.reason);
  }

  return {
    eventId: planned.eventId,
    channel,
    status: result.status,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    attemptedAt,
  };
}

/**
 * Wait for one queue entry's result. Dropped entries are reported
 * synchronously by `enqueue`, so the `"dropped"` return also resolves the
 * promise for queue implementations that only emit played entries.
 */
function enqueueAndWait(queue: AudioQueue, entry: AudioEntry): Promise<AudioQueueResult> {
  return new Promise<AudioQueueResult>((resolve) => {
    const listener = (result: AudioQueueResult): void => {
      if (result.entry !== entry) {
        return;
      }

      unsubscribe();
      resolve(result);
    };

    const unsubscribe = queue.onResult(listener);

    if (queue.enqueue(entry) === "dropped") {
      unsubscribe();
      resolve({ entry, status: "dropped", reason: "queue_overflow_lowest_priority" });
    }
  });
}

async function deliverChannel(
  planned: PlannedNotification,
  channel: Channel,
  deps: DispatchDependencies,
): Promise<DeliveryRecord> {
  const attemptedAt = deps.now();

  if (channel === "desktop") {
    if (planned.rendered === undefined) {
      return failedRecord(planned, channel, attemptedAt, "missing_rendered_notification");
    }

    try {
      const result = await deps.providers.desktop.show({
        title: planned.rendered.title,
        body: planned.rendered.body,
      });
      return providerRecord(planned, channel, attemptedAt, result);
    } catch {
      return failedRecord(planned, channel, attemptedAt, "provider_rejected");
    }
  }

  if (channel === "voice" && planned.rendered === undefined) {
    return failedRecord(planned, channel, attemptedAt, "missing_rendered_notification");
  }

  const entry: AudioEntry =
    channel === "sound"
      ? {
          eventId: planned.eventId,
          eventType: planned.eventType,
          kind: "sound",
          priority: planned.priority,
          payload: (deps.resolveSound ?? defaultSoundRequest)(planned),
        }
      : {
          eventId: planned.eventId,
          eventType: planned.eventType,
          kind: "voice",
          priority: planned.priority,
          payload: (deps.resolveSpeech ?? defaultSpeechRequest)(planned),
        };

  try {
    const result = await enqueueAndWait(deps.queue, entry);
    return audioRecord(planned, channel, attemptedAt, result);
  } catch {
    return failedRecord(planned, channel, attemptedAt, "provider_rejected");
  }
}

/**
 * Dispatch a batch of planned notifications.
 *
 * Returns one record per unique `(eventId, channel)`, in plan order. Channels
 * run concurrently; audio is serialized by the queue. Every record is passed
 * to `recordDelivery` as soon as its channel settles.
 */
export async function dispatchPlanned(
  planned: PlannedNotification[],
  deps: DispatchDependencies,
): Promise<DeliveryRecord[]> {
  const seen = new Set<string>();
  const jobs: Array<() => Promise<DeliveryRecord>> = [];

  for (const notification of planned) {
    for (const plan of notification.channels) {
      const key = `${notification.eventId}\u0000${plan.channel}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      jobs.push(async () => {
        let record: DeliveryRecord;
        try {
          record =
            plan.decision === "suppress"
              ? {
                  eventId: notification.eventId,
                  channel: plan.channel,
                  status: "suppressed",
                  ...(plan.reason === undefined ? {} : { reason: plan.reason }),
                  attemptedAt: deps.now(),
                }
              : await deliverChannel(notification, plan.channel, deps);
        } catch {
          record = failedRecord(notification, plan.channel, deps.now(), "internal_error");
        }

        deps.recordDelivery(record);
        return record;
      });
    }
  }

  const settled = await Promise.allSettled(jobs.map((job) => job()));
  const records: DeliveryRecord[] = [];
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      records.push(result.value);
    }
  }

  if (failure !== undefined) {
    throw failure.reason;
  }

  return records;
}
