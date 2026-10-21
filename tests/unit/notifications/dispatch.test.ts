import { defaultConfig } from "@agent-attention/contract";
import type {
  Channel,
  PlannedChannel,
  PlannedNotification,
  RenderedNotification,
} from "@agent-attention/core";
import {
  createAudioQueue,
  dispatchPlanned,
  providerAudioPlayer,
  type DeliveryRecord,
  type ProviderSet,
} from "@agent-attention/notifications";
import { describe, expect, it, vi } from "vitest";

const NOW = "2026-10-20T10:00:00.000Z";

const RENDERED: RenderedNotification = {
  title: "Builder needs approval",
  body: "agent-attention · 10:00",
  speech: "Builder is waiting for approval.",
};

function channel(
  overrides: Partial<PlannedChannel> & Pick<PlannedChannel, "channel">,
): PlannedChannel {
  return { decision: "dispatch", ...overrides };
}

function makePlan(overrides: Partial<PlannedNotification> = {}): PlannedNotification {
  return {
    eventId: "event-1",
    eventType: "agent.needs_approval",
    priority: 5,
    channels: [
      channel({ channel: "sound" }),
      channel({ channel: "voice" }),
      channel({ channel: "desktop" }),
    ],
    rendered: RENDERED,
    ...overrides,
  };
}

function makeProviders(overrides: Partial<ProviderSet> = {}): ProviderSet {
  return {
    sound: { play: vi.fn(async () => ({ status: "delivered" as const })) },
    voice: { speak: vi.fn(async () => ({ status: "delivered" as const })) },
    desktop: { show: vi.fn(async () => ({ status: "delivered" as const })) },
    ...overrides,
  };
}

function makeQueue(providers: ProviderSet, maxQueueLength = 10) {
  return createAudioQueue({
    maxQueueLength,
    play: providerAudioPlayer(providers),
  });
}

function makeDeps(
  providers: ProviderSet,
  queue: ReturnType<typeof makeQueue>,
  extra: {
    resolveSound?: Parameters<typeof dispatchPlanned>[1]["resolveSound"];
    resolveSpeech?: Parameters<typeof dispatchPlanned>[1]["resolveSpeech"];
  } = {},
) {
  const recorded: DeliveryRecord[] = [];
  return {
    providers,
    queue,
    recordDelivery: (record: DeliveryRecord) => recorded.push(record),
    now: () => NOW,
    recorded,
    ...extra,
  };
}

function find(
  records: DeliveryRecord[],
  eventId: string,
  target: Channel,
): DeliveryRecord | undefined {
  return records.find((record) => record.eventId === eventId && record.channel === target);
}

describe("dispatchPlanned", () => {
  it("keeps channels independent when the sound provider rejects (AC-F6-05, RF4)", async () => {
    const providers = makeProviders({
      sound: {
        play: vi.fn(async () => {
          throw new Error("audio device gone");
        }),
      },
    });
    const queue = makeQueue(providers);
    const deps = makeDeps(providers, queue);

    const records = await dispatchPlanned(
      [
        makePlan({
          channels: [
            channel({ channel: "sound" }),
            channel({ channel: "voice", decision: "suppress", reason: "quiet_hours" }),
            channel({ channel: "desktop" }),
          ],
        }),
      ],
      deps,
    );

    expect(records).toHaveLength(3);
    expect(find(records, "event-1", "sound")).toMatchObject({
      status: "failed",
      errorCode: "provider_rejected",
    });
    expect(find(records, "event-1", "desktop")).toMatchObject({ status: "delivered" });
    expect(find(records, "event-1", "voice")).toMatchObject({
      status: "suppressed",
      reason: "quiet_hours",
    });
    expect(providers.desktop.show).toHaveBeenCalledTimes(1);
    expect(providers.voice.speak).not.toHaveBeenCalled();
    expect(deps.recorded).toHaveLength(records.length);
    for (const record of records) {
      expect(deps.recorded).toContainEqual(record);
    }
  });

  it("keeps audio working when the desktop provider rejects (AC-F6-05)", async () => {
    const providers = makeProviders({
      desktop: {
        show: vi.fn(async () => {
          throw new Error("toast identity missing");
        }),
      },
    });
    const queue = makeQueue(providers);
    const records = await dispatchPlanned([makePlan()], makeDeps(providers, queue));

    expect(find(records, "event-1", "desktop")).toMatchObject({
      status: "failed",
      errorCode: "provider_rejected",
    });
    expect(find(records, "event-1", "sound")).toMatchObject({ status: "delivered" });
    expect(find(records, "event-1", "voice")).toMatchObject({ status: "delivered" });
  });

  it("records suppressed plans verbatim without invoking a provider", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    const records = await dispatchPlanned(
      [
        makePlan({
          channels: [
            channel({ channel: "sound", decision: "suppress", reason: "muted" }),
            channel({ channel: "voice", decision: "suppress", reason: "rate_limit" }),
            channel({ channel: "desktop", decision: "suppress", reason: "grace_superseded" }),
          ],
        }),
      ],
      makeDeps(providers, queue),
    );

    expect(records).toEqual([
      {
        eventId: "event-1",
        channel: "sound",
        status: "suppressed",
        reason: "muted",
        attemptedAt: NOW,
      },
      {
        eventId: "event-1",
        channel: "voice",
        status: "suppressed",
        reason: "rate_limit",
        attemptedAt: NOW,
      },
      {
        eventId: "event-1",
        channel: "desktop",
        status: "suppressed",
        reason: "grace_superseded",
        attemptedAt: NOW,
      },
    ]);
    expect(providers.sound.play).not.toHaveBeenCalled();
    expect(providers.voice.speak).not.toHaveBeenCalled();
    expect(providers.desktop.show).not.toHaveBeenCalled();
  });

  it("produces exactly one delivery per (eventId, channel) for duplicate plans", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    const plan = makePlan({
      channels: [channel({ channel: "sound" }), channel({ channel: "desktop" })],
    });

    const records = await dispatchPlanned([plan, plan], makeDeps(providers, queue));

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.channel)).toEqual(["sound", "desktop"]);
    expect(providers.sound.play).toHaveBeenCalledTimes(1);
    expect(providers.desktop.show).toHaveBeenCalledTimes(1);
  });

  it("preserves provider unavailable results instead of failing the dispatch", async () => {
    const providers = makeProviders({
      voice: {
        speak: vi.fn(async () => ({
          status: "unavailable" as const,
          errorCode: "no_voice_installed",
        })),
      },
    });
    const queue = makeQueue(providers);
    const records = await dispatchPlanned([makePlan()], makeDeps(providers, queue));

    expect(find(records, "event-1", "voice")).toMatchObject({
      status: "unavailable",
      errorCode: "no_voice_installed",
    });
    expect(find(records, "event-1", "sound")).toMatchObject({ status: "delivered" });
    expect(find(records, "event-1", "desktop")).toMatchObject({ status: "delivered" });
  });

  it("records queue overflow as a failed audio delivery (F12-R2)", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers, 1);
    const plans: PlannedNotification[] = [
      makePlan({
        eventId: "approval",
        eventType: "agent.needs_approval",
        priority: 5,
        channels: [channel({ channel: "sound" })],
      }),
      makePlan({
        eventId: "input",
        eventType: "agent.needs_input",
        priority: 4,
        channels: [channel({ channel: "sound" })],
      }),
      makePlan({
        eventId: "completed",
        eventType: "agent.completed",
        priority: 1,
        channels: [channel({ channel: "sound" })],
      }),
    ];

    const records = await dispatchPlanned(plans, makeDeps(providers, queue));

    expect(find(records, "approval", "sound")).toMatchObject({ status: "delivered" });
    expect(find(records, "input", "sound")).toMatchObject({
      status: "failed",
      reason: "queue_overflow_lowest_priority",
      errorCode: "queue_overflow_lowest_priority",
    });
    expect(find(records, "completed", "sound")).toMatchObject({
      status: "failed",
      reason: "queue_overflow_lowest_priority",
    });
    expect(providers.sound.play).toHaveBeenCalledTimes(1);
  });

  it("fails only the rendered channels when a plan has no rendered text", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    const plan = makePlan({ rendered: undefined });

    const records = await dispatchPlanned([plan], makeDeps(providers, queue));

    expect(find(records, "event-1", "sound")).toMatchObject({ status: "delivered" });
    expect(find(records, "event-1", "voice")).toMatchObject({
      status: "failed",
      errorCode: "missing_rendered_notification",
    });
    expect(find(records, "event-1", "desktop")).toMatchObject({
      status: "failed",
      errorCode: "missing_rendered_notification",
    });
  });

  it("uses the default sound and speech settings derived from the event class", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    await dispatchPlanned([makePlan()], makeDeps(providers, queue));

    expect(providers.sound.play).toHaveBeenCalledWith({
      soundId: defaultConfig.events.needsApproval.sound.soundId,
      volume: defaultConfig.events.needsApproval.sound.volume,
    });
    expect(providers.voice.speak).toHaveBeenCalledWith({
      text: RENDERED.speech,
      voiceId: defaultConfig.voice.voiceId,
      volume: defaultConfig.voice.volume,
      rate: defaultConfig.voice.rate,
    });
    expect(providers.desktop.show).toHaveBeenCalledWith({
      title: RENDERED.title,
      body: RENDERED.body,
    });
  });

  it("lets the host supply effective sound and speech settings per plan", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    const deps = makeDeps(providers, queue, {
      resolveSound: () => ({ soundId: "custom", volume: 12 }),
      resolveSpeech: () => ({ text: "custom speech", voiceId: "voice-1", volume: 22, rate: 3 }),
    });

    await dispatchPlanned([makePlan()], deps);

    expect(providers.sound.play).toHaveBeenCalledWith({ soundId: "custom", volume: 12 });
    expect(providers.voice.speak).toHaveBeenCalledWith({
      text: "custom speech",
      voiceId: "voice-1",
      volume: 22,
      rate: 3,
    });
  });

  it("returns one record per planned channel in plan order", async () => {
    const providers = makeProviders();
    const queue = makeQueue(providers);
    const records = await dispatchPlanned(
      [
        makePlan({ eventId: "one" }),
        makePlan({
          eventId: "two",
          eventType: "agent.completed",
          priority: 1,
          channels: [channel({ channel: "sound" }), channel({ channel: "desktop" })],
        }),
      ],
      makeDeps(providers, queue),
    );

    expect(records.map((record) => `${record.eventId}:${record.channel}`)).toEqual([
      "one:sound",
      "one:voice",
      "one:desktop",
      "two:sound",
      "two:desktop",
    ]);
    expect(records.every((record) => record.attemptedAt === NOW)).toBe(true);
  });

  it("does not throw when a provider rejects synchronously", async () => {
    const providers = makeProviders({
      desktop: {
        show: vi.fn(() => {
          throw new Error("boom");
        }),
      },
    });
    const queue = makeQueue(providers);

    await expect(dispatchPlanned([makePlan()], makeDeps(providers, queue))).resolves.toHaveLength(
      3,
    );
  });
});
