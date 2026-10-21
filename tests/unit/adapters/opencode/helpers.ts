/**
 * Shared helpers for OpenCode adapter tests.
 *
 * Fixtures are sanitized raw host streams. Only records with `kind: "event"`
 * are replayed; probe records document setup and are not host signals.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defaultConfig, type AgentEvent } from "@agent-attention/contract";
import {
  RollingRateLimiter,
  type PipelineDependencies,
  type PipelineStore,
} from "@agent-attention/core";

import { capabilitiesFor } from "../../../../adapters/opencode/src/capabilities";
import { createNormalizer } from "../../../../adapters/opencode/src/normalize/normalizer";
import type {
  AdapterHostContext,
  OpenCodeEvent,
} from "../../../../adapters/opencode/src/types";
import { MemoryPipelineStore } from "../../../helpers/memory-store";

export const FIXTURE_DIR = resolve(process.cwd(), "tests", "fixtures", "opencode");
export const RECEIVED_AT = Date.parse("2026-10-20T10:00:00.000Z");
export const PIPELINE_NOW = "2026-10-20T10:00:00.000Z";

/** Host payload text that must never appear in a normalized event. */
export const PAYLOAD_DECOYS = [
  "echo probe",
  "echo *",
  "call_",
  "msg_",
  "bash.exe",
  "<USER_HOME>",
  "sh_",
  ".out",
  "The user declined",
  "Step interrupted",
  "The requested model is not supported",
  "provider.invalid-request",
  "model_not_supported",
  "PLAIN_TEXT_OK",
  "NEGATIVE_PROGRESS_OK",
  "PROBE_OK",
  "SUBAGENT_OK",
  "Use the bash/shell tool",
  "Reply with exactly",
  "assistantMessageID",
  "deepseek-v4.1-flash-free",
  "snapshot",
  "tokens",
  "resources",
  "shell",
  '"action"',
  '"save"',
] as const;

export interface FixtureSetupRecord {
  app: { name: string; version: string };
  location: AdapterHostContext["location"];
}

export interface LoadedFixture {
  name: string;
  context: AdapterHostContext;
  events: OpenCodeEvent[];
  raw: string;
}

export interface NormalizedFixture extends LoadedFixture {
  emitted: AgentEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toOpenCodeEvent(value: unknown, fixture: string, line: number): OpenCodeEvent {
  if (!isRecord(value)) {
    throw new Error(`${fixture}:${line}: event must be an object`);
  }

  const id = readString(value, "id");
  const type = readString(value, "type");
  const created = value.created;
  if (id === undefined || type === undefined || typeof created !== "number") {
    throw new Error(`${fixture}:${line}: event is missing id, type, or created`);
  }

  const durableValue = value.durable;
  let durable: OpenCodeEvent["durable"];
  if (durableValue !== undefined) {
    if (!isRecord(durableValue)) {
      throw new Error(`${fixture}:${line}: durable must be an object`);
    }
    const aggregateID = readString(durableValue, "aggregateID");
    const seq = durableValue.seq;
    const version = durableValue.version;
    if (aggregateID === undefined || typeof seq !== "number" || typeof version !== "number") {
      throw new Error(`${fixture}:${line}: durable is malformed`);
    }
    durable = { aggregateID, seq, version };
  }

  const locationValue = value.location;
  let location: OpenCodeEvent["location"];
  if (locationValue !== undefined) {
    if (!isRecord(locationValue)) {
      throw new Error(`${fixture}:${line}: location must be an object`);
    }
    const directory = readString(locationValue, "directory");
    if (directory !== undefined) {
      location = { directory };
    }
  }

  const dataValue = value.data;
  let data: Record<string, unknown> | undefined;
  if (dataValue !== undefined) {
    if (!isRecord(dataValue)) {
      throw new Error(`${fixture}:${line}: data must be an object`);
    }
    data = dataValue;
  }

  return {
    id,
    created,
    type,
    ...(durable === undefined ? {} : { durable }),
    ...(location === undefined ? {} : { location }),
    ...(data === undefined ? {} : { data }),
  };
}

function setupFromRecord(record: Record<string, unknown>, fixture: string): FixtureSetupRecord {
  const appValue = record.app;
  const locationValue = record.location;
  if (!isRecord(appValue) || !isRecord(locationValue)) {
    throw new Error(`${fixture}: plugin.setup is missing app or location`);
  }

  const appName = readString(appValue, "name") ?? "cli";
  const appVersion = readString(appValue, "version") ?? "2.0.32";
  const directory = readString(locationValue, "directory");
  if (directory === undefined) {
    throw new Error(`${fixture}: plugin.setup location is missing a directory`);
  }

  const projectValue = locationValue.project;
  let project: NonNullable<AdapterHostContext["location"]["project"]> | undefined;
  if (projectValue !== undefined) {
    if (!isRecord(projectValue)) {
      throw new Error(`${fixture}: plugin.setup project must be an object`);
    }
    const id = readString(projectValue, "id");
    const projectDirectory = readString(projectValue, "directory");
    if (id === undefined || projectDirectory === undefined) {
      throw new Error(`${fixture}: plugin.setup project is malformed`);
    }
    const canonical = readString(projectValue, "canonical");
    project = {
      id,
      directory: projectDirectory,
      ...(canonical === undefined ? {} : { canonical }),
    };
  }

  return {
    app: { name: appName, version: appVersion },
    location: { directory, ...(project === undefined ? {} : { project }) },
  };
}

/** Load a frozen fixture and extract replayable host events plus setup context. */
export function loadFixture(name: string): LoadedFixture {
  const path = resolve(FIXTURE_DIR, name);
  const raw = readFileSync(path, "utf8");
  const events: OpenCodeEvent[] = [];
  let setup: FixtureSetupRecord | undefined;

  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") {
      return;
    }

    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `${name}:${index + 1}: invalid JSON (${error instanceof Error ? error.message : "unknown"})`,
      );
    }
    if (!isRecord(record)) {
      throw new Error(`${name}:${index + 1}: record must be an object`);
    }

    if (record.kind === "plugin.setup") {
      setup = {
        ...(setupFromRecord(record, name)),
      };
      return;
    }

    if (record.kind === "event") {
      events.push(toOpenCodeEvent(record.event, name, index + 1));
    }
  });

  if (setup === undefined) {
    throw new Error(`${name}: missing plugin.setup record`);
  }

  return {
    name,
    context: { app: setup.app, location: setup.location },
    events,
    raw,
  };
}

export interface NormalizeOptions {
  now?: () => number;
  context?: AdapterHostContext;
}

/** Replay a fixture through the normalizer with a fixed receive clock. */
export function normalizeFixture(name: string, options: NormalizeOptions = {}): NormalizedFixture {
  const fixture = loadFixture(name);
  const normalizer = createNormalizer({
    context: options.context ?? fixture.context,
    capabilities: capabilitiesFor(fixture.context.app.version),
    now: options.now ?? (() => RECEIVED_AT),
  });

  const emitted = fixture.events.flatMap((event) => normalizer.normalize(event));
  return { ...fixture, emitted };
}

/** Replay arbitrary events with a normalizer for one fixture-style context. */
export function normalizeEvents(
  events: readonly OpenCodeEvent[],
  context: AdapterHostContext,
  now: () => number = () => RECEIVED_AT,
): AgentEvent[] {
  const normalizer = createNormalizer({
    context,
    capabilities: capabilitiesFor(context.app.version),
    now,
  });
  return events.flatMap((event) => normalizer.normalize(event));
}

export function makePipelineDeps(store: PipelineStore): PipelineDependencies {
  const config = structuredClone(defaultConfig);
  return {
    store,
    config,
    capabilities: capabilitiesFor("2.0.32"),
    clock: {
      now: () => PIPELINE_NOW,
      nowMs: () => Date.parse(PIPELINE_NOW),
    },
    rateLimiter: new RollingRateLimiter(config.rateLimit.maxAlertsPerMinute),
    quietHoursMinutes: () => 12 * 60,
  };
}

export function newMemoryStore(): MemoryPipelineStore {
  return new MemoryPipelineStore();
}

/** Serialized form used for payload-leak assertions. */
export function serialized(events: readonly AgentEvent[]): string {
  return JSON.stringify(events);
}

export function expectNoPayloadDecoys(events: readonly AgentEvent[]): void {
  const json = serialized(events);
  for (const decoy of PAYLOAD_DECOYS) {
    if (json.includes(decoy)) {
      throw new Error(`normalized event leaked host payload decoy: ${decoy}`);
    }
  }
}
