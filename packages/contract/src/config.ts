/**
 * Configuration schema, defaults, and per-key fallback (PRD.md §8).
 *
 * User preferences live only in this file. Invalid values fall back to the
 * default for that key and produce a diagnostic; unknown keys are reported and
 * stripped here (the writer preserves them separately, PRD §8.1).
 */

import { z } from "zod";
import { CONFIG_SCHEMA_VERSION } from "./versions";

export type SoundId = "attention" | "approval" | "idle" | "complete" | "failure";
export type PrivacyMode = "standard" | "discreet";

export interface ChannelToggle {
  enabled: boolean;
}

export interface SoundChannelConfig extends ChannelToggle {
  soundId: SoundId;
  volume: number;
}

export interface EventConfig {
  enabled: boolean;
  sound: SoundChannelConfig;
  voice: ChannelToggle;
  desktop: ChannelToggle;
}

export interface TurnEndedEventConfig extends EventConfig {
  minTurnSeconds: number;
  graceMs: number;
}

export interface FailedEventConfig extends EventConfig {
  notifyOnCancelled: boolean;
}

export interface EventsConfig {
  needsInput: EventConfig;
  needsApproval: EventConfig;
  turnEnded: TurnEndedEventConfig;
  completed: EventConfig;
  failed: FailedEventConfig;
}

export interface VoiceConfig {
  voiceId: string | null;
  volume: number;
  rate: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
  suppressSound: boolean;
  suppressVoice: boolean;
  suppressDesktop: boolean;
}

export interface FocusConfig {
  enabled: boolean;
  bypassForApproval: boolean;
}

export interface AudioConfig {
  maxQueueLength: number;
}

export interface RateLimitConfig {
  maxAlertsPerMinute: number;
  coalesceWindowSeconds: number;
}

export interface RemindersConfig {
  enabled: boolean;
  afterMinutes: number;
  maxReminders: number;
}

export interface PrivacyConfig {
  mode: PrivacyMode;
  showProjectName: boolean;
}

export interface SubagentsConfig {
  notify: boolean;
}

export interface DeduplicationConfig {
  fallbackWindowSeconds: number;
}

export interface StaleConfig {
  workingAfterMinutes: number;
}

export interface ActivityHistoryConfig {
  enabled: boolean;
  retentionDays: number;
}

export interface AgentAttentionConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  globalMute: boolean;
  channels: {
    sound: boolean;
    voice: boolean;
    desktop: boolean;
  };
  events: EventsConfig;
  voice: VoiceConfig;
  quietHours: QuietHoursConfig;
  focus: FocusConfig;
  audio: AudioConfig;
  rateLimit: RateLimitConfig;
  reminders: RemindersConfig;
  privacy: PrivacyConfig;
  subagents: SubagentsConfig;
  deduplication: DeduplicationConfig;
  stale: StaleConfig;
  activityHistory: ActivityHistoryConfig;
}

export type ConfigDiagnosticCode = "invalid_value" | "unknown_key" | "unsupported_version";

export interface ConfigDiagnostic {
  keyPath: string;
  code: ConfigDiagnosticCode;
  message: string;
  appliedFallback: unknown;
}

export interface ConfigParseResult {
  config: AgentAttentionConfig;
  diagnostics: ConfigDiagnostic[];
}

/** Default user configuration (values verbatim from PRD.md §8.3). */
export const defaultConfig: AgentAttentionConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  globalMute: false,
  channels: { sound: true, voice: false, desktop: true },

  events: {
    needsInput: {
      enabled: true,
      sound: { enabled: true, soundId: "attention", volume: 35 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    needsApproval: {
      enabled: true,
      sound: { enabled: true, soundId: "approval", volume: 45 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    turnEnded: {
      enabled: true,
      sound: { enabled: true, soundId: "idle", volume: 25 },
      voice: { enabled: false },
      desktop: { enabled: true },
      minTurnSeconds: 15,
      graceMs: 1000,
    },
    completed: {
      enabled: true,
      sound: { enabled: true, soundId: "complete", volume: 25 },
      voice: { enabled: false },
      desktop: { enabled: true },
    },
    failed: {
      enabled: true,
      sound: { enabled: true, soundId: "failure", volume: 40 },
      voice: { enabled: false },
      desktop: { enabled: true },
      notifyOnCancelled: false,
    },
  },

  voice: { voiceId: null, volume: 50, rate: 0 },

  quietHours: {
    enabled: false,
    startTime: "23:00",
    endTime: "08:00",
    suppressSound: true,
    suppressVoice: true,
    suppressDesktop: false,
  },

  focus: { enabled: true, bypassForApproval: false },

  audio: { maxQueueLength: 3 },
  rateLimit: { maxAlertsPerMinute: 6, coalesceWindowSeconds: 5 },

  reminders: { enabled: false, afterMinutes: 10, maxReminders: 1 },

  privacy: { mode: "standard", showProjectName: true },

  subagents: { notify: false },

  deduplication: { fallbackWindowSeconds: 30 },
  stale: { workingAfterMinutes: 15 },

  activityHistory: { enabled: true, retentionDays: 7 },
};

interface LeafSpec {
  kind: "leaf";
  schema: z.ZodType<unknown>;
  fallback: unknown;
}

interface ObjectSpec {
  kind: "object";
  children: Record<string, Spec>;
}

type Spec = LeafSpec | ObjectSpec;

function leaf<T>(schema: z.ZodType<T>, fallback: T): LeafSpec {
  return { kind: "leaf", schema: schema as z.ZodType<unknown>, fallback };
}

function object(children: Record<string, Spec>): ObjectSpec {
  return { kind: "object", children };
}

const volumeSchema = z.number().int().min(0).max(100);
const soundIdSchema = z.enum(["attention", "approval", "idle", "complete", "failure"]);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function eventSpec(defaults: EventConfig): ObjectSpec {
  return object({
    enabled: leaf(z.boolean(), defaults.enabled),
    sound: object({
      enabled: leaf(z.boolean(), defaults.sound.enabled),
      soundId: leaf(soundIdSchema, defaults.sound.soundId),
      volume: leaf(volumeSchema, defaults.sound.volume),
    }),
    voice: object({ enabled: leaf(z.boolean(), defaults.voice.enabled) }),
    desktop: object({ enabled: leaf(z.boolean(), defaults.desktop.enabled) }),
  });
}

const configSpec: ObjectSpec = object({
  schemaVersion: leaf(z.literal(CONFIG_SCHEMA_VERSION), CONFIG_SCHEMA_VERSION),
  globalMute: leaf(z.boolean(), defaultConfig.globalMute),
  channels: object({
    sound: leaf(z.boolean(), defaultConfig.channels.sound),
    voice: leaf(z.boolean(), defaultConfig.channels.voice),
    desktop: leaf(z.boolean(), defaultConfig.channels.desktop),
  }),
  events: object({
    needsInput: eventSpec(defaultConfig.events.needsInput),
    needsApproval: eventSpec(defaultConfig.events.needsApproval),
    turnEnded: object({
      ...eventSpec(defaultConfig.events.turnEnded).children,
      minTurnSeconds: leaf(
        z.number().int().nonnegative(),
        defaultConfig.events.turnEnded.minTurnSeconds,
      ),
      graceMs: leaf(z.number().int().nonnegative(), defaultConfig.events.turnEnded.graceMs),
    }),
    completed: eventSpec(defaultConfig.events.completed),
    failed: object({
      ...eventSpec(defaultConfig.events.failed).children,
      notifyOnCancelled: leaf(z.boolean(), defaultConfig.events.failed.notifyOnCancelled),
    }),
  }),
  voice: object({
    voiceId: leaf(z.string().nullable(), defaultConfig.voice.voiceId),
    volume: leaf(volumeSchema, defaultConfig.voice.volume),
    rate: leaf(z.number(), defaultConfig.voice.rate),
  }),
  quietHours: object({
    enabled: leaf(z.boolean(), defaultConfig.quietHours.enabled),
    startTime: leaf(timeSchema, defaultConfig.quietHours.startTime),
    endTime: leaf(timeSchema, defaultConfig.quietHours.endTime),
    suppressSound: leaf(z.boolean(), defaultConfig.quietHours.suppressSound),
    suppressVoice: leaf(z.boolean(), defaultConfig.quietHours.suppressVoice),
    suppressDesktop: leaf(z.boolean(), defaultConfig.quietHours.suppressDesktop),
  }),
  focus: object({
    enabled: leaf(z.boolean(), defaultConfig.focus.enabled),
    bypassForApproval: leaf(z.boolean(), defaultConfig.focus.bypassForApproval),
  }),
  audio: object({
    maxQueueLength: leaf(z.number().int().positive(), defaultConfig.audio.maxQueueLength),
  }),
  rateLimit: object({
    maxAlertsPerMinute: leaf(
      z.number().int().positive(),
      defaultConfig.rateLimit.maxAlertsPerMinute,
    ),
    coalesceWindowSeconds: leaf(
      z.number().int().nonnegative(),
      defaultConfig.rateLimit.coalesceWindowSeconds,
    ),
  }),
  reminders: object({
    enabled: leaf(z.boolean(), defaultConfig.reminders.enabled),
    afterMinutes: leaf(z.number().int().nonnegative(), defaultConfig.reminders.afterMinutes),
    maxReminders: leaf(z.number().int().nonnegative(), defaultConfig.reminders.maxReminders),
  }),
  privacy: object({
    mode: leaf(z.enum(["standard", "discreet"]), defaultConfig.privacy.mode),
    showProjectName: leaf(z.boolean(), defaultConfig.privacy.showProjectName),
  }),
  subagents: object({
    notify: leaf(z.boolean(), defaultConfig.subagents.notify),
  }),
  deduplication: object({
    fallbackWindowSeconds: leaf(
      z.number().int().positive(),
      defaultConfig.deduplication.fallbackWindowSeconds,
    ),
  }),
  stale: object({
    workingAfterMinutes: leaf(z.number().int().positive(), defaultConfig.stale.workingAfterMinutes),
  }),
  activityHistory: object({
    enabled: leaf(z.boolean(), defaultConfig.activityHistory.enabled),
    retentionDays: leaf(
      z.number().int().nonnegative(),
      defaultConfig.activityHistory.retentionDays,
    ),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  return base.length > 0 ? `${base}.${key}` : key;
}

function buildDefaults(spec: Spec): unknown {
  if (spec.kind === "leaf") {
    return spec.fallback;
  }

  return Object.fromEntries(
    Object.entries(spec.children).map(([key, child]) => [key, buildDefaults(child)]),
  );
}

function walk(value: unknown, spec: Spec, path: string, diagnostics: ConfigDiagnostic[]): unknown {
  if (spec.kind === "leaf") {
    if (value === undefined) {
      return spec.fallback;
    }

    const parsed = spec.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    const fallback = spec.schema.catch(spec.fallback).parse(value);
    diagnostics.push({
      keyPath: path,
      code: "invalid_value",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
      appliedFallback: fallback,
    });
    return fallback;
  }

  if (value === undefined) {
    return buildDefaults(spec);
  }

  if (!isRecord(value)) {
    const fallback = buildDefaults(spec);
    diagnostics.push({
      keyPath: path,
      code: "invalid_value",
      message: "must be an object",
      appliedFallback: fallback,
    });
    return fallback;
  }

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(value)) {
    if (spec.children[key] === undefined) {
      diagnostics.push({
        keyPath: joinPath(path, key),
        code: "unknown_key",
        message: "unknown configuration key",
        appliedFallback: undefined,
      });
    }
  }

  for (const [key, child] of Object.entries(spec.children)) {
    result[key] = walk(value[key], child, joinPath(path, key), diagnostics);
  }

  return result;
}

/**
 * Validate a raw configuration object. Invalid values fall back per key and
 * are reported; unknown keys are reported and stripped. A non-current
 * `schemaVersion` is rejected and the defaults are returned (PRD §8.1:
 * migrations are forward-only).
 */
export function parseConfig(raw: unknown): ConfigParseResult {
  if (raw !== undefined && !isRecord(raw)) {
    return {
      config: buildDefaults(configSpec) as AgentAttentionConfig,
      diagnostics: [
        {
          keyPath: "",
          code: "invalid_value",
          message: "configuration must be an object",
          appliedFallback: buildDefaults(configSpec),
        },
      ],
    };
  }

  const record = raw ?? {};

  if (record.schemaVersion !== undefined && record.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return {
      config: buildDefaults(configSpec) as AgentAttentionConfig,
      diagnostics: [
        {
          keyPath: "schemaVersion",
          code: "unsupported_version",
          message: `unsupported schemaVersion: expected ${CONFIG_SCHEMA_VERSION}`,
          appliedFallback: CONFIG_SCHEMA_VERSION,
        },
      ],
    };
  }

  const diagnostics: ConfigDiagnostic[] = [];
  const config = walk(record, configSpec, "", diagnostics);

  return { config: config as AgentAttentionConfig, diagnostics };
}
