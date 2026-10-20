/**
 * Fixture loading and deterministic replay (Phase 1 Task 1.17).
 *
 * A fixture is JSONL:
 * - exactly one `meta` line, first;
 * - zero or more `event` lines wrapping a full `AgentEvent`;
 * - zero or more `expected` lines with the final session snapshot.
 *
 * Replay is deterministic: storage, clock, rate limiting, and quiet-hours
 * minutes are all injected. Replaying the same stream twice against the same
 * store must not re-deliver notifications.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAgentEvent, type AgentEvent } from "@agent-attention/contract";
import {
  processEvent,
  type PipelineDependencies,
  type PlannedNotification,
  type ProcessingResult,
} from "@agent-attention/core";
import type { SessionRecord } from "@agent-attention/core";

const FIXTURES_DIR = resolve(process.cwd(), "tests", "fixtures");

const SESSION_STATES: ReadonlySet<string> = new Set<SessionRecord["state"]>([
  "working",
  "waiting_for_input",
  "waiting_for_approval",
  "idle",
  "completed",
  "failed",
  "ended",
  "unknown",
]);

const CONFIDENCES: ReadonlySet<string> = new Set<SessionRecord["stateConfidence"]>([
  "authoritative",
  "inferred",
  "unverified",
]);

export interface FixtureMeta {
  name: string;
  host: string;
  recordedAt: string;
  hostVersion: string;
}

export interface ExpectedSessionSnapshot {
  adapterId: string;
  sessionId: string;
  state: SessionRecord["state"];
  stateConfidence: SessionRecord["stateConfidence"];
}

export interface FixtureStream {
  name: string;
  meta: FixtureMeta;
  events: AgentEvent[];
  expected: ExpectedSessionSnapshot[];
}

export interface ReplayResult {
  sessions: SessionRecord[];
  notifications: PlannedNotification[];
  statuses: Array<ProcessingResult["status"]>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(fixture: string, line: number, message: string): never {
  throw new Error(`${fixture}:${line}: ${message}`);
}

function stringField(
  fixture: string,
  line: number,
  record: JsonObject,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    fail(fixture, line, `"${field}" must be a non-empty string`);
  }
  return value;
}

function parseMeta(fixture: string, line: number, record: JsonObject): FixtureMeta {
  return {
    name: stringField(fixture, line, record, "name"),
    host: stringField(fixture, line, record, "host"),
    recordedAt: stringField(fixture, line, record, "recordedAt"),
    hostVersion: stringField(fixture, line, record, "hostVersion"),
  };
}

function parseExpected(
  fixture: string,
  line: number,
  record: JsonObject,
): ExpectedSessionSnapshot {
  const state = stringField(fixture, line, record, "state");
  if (!SESSION_STATES.has(state)) {
    fail(fixture, line, `unknown session state "${state}"`);
  }

  const stateConfidence = stringField(fixture, line, record, "stateConfidence");
  if (!CONFIDENCES.has(stateConfidence)) {
    fail(fixture, line, `unknown state confidence "${stateConfidence}"`);
  }

  return {
    adapterId: stringField(fixture, line, record, "adapterId"),
    sessionId: stringField(fixture, line, record, "sessionId"),
    state: state as SessionRecord["state"],
    stateConfidence: stateConfidence as SessionRecord["stateConfidence"],
  };
}

/**
 * Parse fixture JSONL. Throws an error with the fixture name and line number
 * on malformed input, an invalid event, or a bad expected snapshot.
 */
export function parseFixture(text: string, fixtureName = "inline"): FixtureStream {
  let meta: FixtureMeta | undefined;
  let sawContent = false;
  const events: AgentEvent[] = [];
  const expected: ExpectedSessionSnapshot[] = [];

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index]?.trim() ?? "";
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid JSON";
      fail(fixtureName, lineNumber, `could not parse JSON (${detail})`);
    }

    if (!isObject(record)) {
      fail(fixtureName, lineNumber, "each line must be a JSON object");
    }

    const kind = record.kind;
    if (kind === "meta") {
      if (meta !== undefined) {
        fail(fixtureName, lineNumber, "duplicate meta line");
      }
      if (sawContent) {
        fail(fixtureName, lineNumber, "meta must be the first content line");
      }
      meta = parseMeta(fixtureName, lineNumber, record);
    } else {
      if (meta === undefined) {
        fail(fixtureName, lineNumber, "meta must be the first content line");
      }

      if (kind === "event") {
        if (!isObject(record.event)) {
          fail(fixtureName, lineNumber, "\"event\" must be an object");
        }
        const parsed = parseAgentEvent(record.event);
        if (!parsed.ok) {
          const details = parsed.errors
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ");
          fail(fixtureName, lineNumber, `invalid event (${details})`);
        }
        events.push(parsed.event);
      } else if (kind === "expected") {
        expected.push(parseExpected(fixtureName, lineNumber, record));
      } else {
        fail(fixtureName, lineNumber, `unknown record kind "${String(kind)}"`);
      }
    }

    sawContent = true;
  }

  if (meta === undefined) {
    fail(fixtureName, 1, "missing meta line");
  }
  if (events.length === 0) {
    fail(fixtureName, 1, "fixture contains no events");
  }

  return { name: meta.name, meta, events, expected };
}

/** Load a fixture relative to `tests/fixtures/`. */
export function loadFixture(name: string): FixtureStream {
  const path = resolve(FIXTURES_DIR, name);
  return parseFixture(readFileSync(path, "utf8"), name);
}

function assertExpected(
  fixtureName: string,
  expected: ExpectedSessionSnapshot,
  session: SessionRecord,
): void {
  const differences: string[] = [];
  if (session.state !== expected.state) {
    differences.push(`state: expected "${expected.state}", got "${session.state}"`);
  }
  if (session.stateConfidence !== expected.stateConfidence) {
    differences.push(
      `stateConfidence: expected "${expected.stateConfidence}", got "${session.stateConfidence}"`,
    );
  }

  if (differences.length > 0) {
    throw new Error(
      `${fixtureName}: session ${expected.adapterId}/${expected.sessionId} mismatch\n${differences.join("\n")}`,
    );
  }
}

/**
 * Replay every event in order through the real pipeline, then verify each
 * expected session snapshot. Notifications are returned for assertions.
 */
export function replayFixture(
  stream: FixtureStream,
  deps: PipelineDependencies,
): ReplayResult {
  const notifications: PlannedNotification[] = [];
  const statuses: Array<ProcessingResult["status"]> = [];

  for (const event of stream.events) {
    const result = processEvent(event, deps);
    statuses.push(result.status);
    notifications.push(...result.planned);
  }

  const sessions: SessionRecord[] = [];
  for (const expected of stream.expected) {
    const session = deps.store.loadSession(expected.adapterId, expected.sessionId);
    if (session === undefined) {
      throw new Error(
        `${stream.name}: no session ${expected.adapterId}/${expected.sessionId} after replay`,
      );
    }
    assertExpected(stream.name, expected, session);
    sessions.push(session);
  }

  return { sessions, notifications, statuses };
}
