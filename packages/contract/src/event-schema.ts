/**
 * Strict validation for the common agent event contract (PRD.md §12).
 *
 * Validation never throws. Failures are returned as diagnostic issues and the
 * caller decides whether to record them. The schema is strict at every level:
 * free text from an agent is not part of the contract.
 */

import { z } from "zod";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventDetails,
  type AgentEventType,
} from "./events";
import { containsUnsafeCharacters, sanitizeDisplayName } from "./safe-name";
import { SUMMARY_CODES } from "./summary";
import { EVENT_SCHEMA_VERSION } from "./versions";

export type ValidationIssueCode =
  "schema" | "unsupported_version" | "unsupported_type" | "missing_details" | "invalid_field";

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
}

export type EventParseResult =
  { ok: true; event: AgentEvent } | { ok: false; errors: ValidationIssue[] };

const NAME_MAX_LENGTH = 64;
const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const identifierSchema = z.string().min(1);

const timestampSchema = z
  .string()
  .refine(
    (value) => ISO_WITH_TIMEZONE.test(value) && !Number.isNaN(Date.parse(value)),
    "must be an ISO 8601 timestamp with timezone",
  );

const nameSchema = z.string().superRefine((value, ctx) => {
  if (Array.from(value).length > NAME_MAX_LENGTH) {
    ctx.addIssue({
      code: "custom",
      message: `must be at most ${NAME_MAX_LENGTH} characters`,
    });
  }

  if (containsUnsafeCharacters(value)) {
    ctx.addIssue({
      code: "custom",
      message: "must not contain control or bidirectional-override characters",
    });
  }

  if (sanitizeDisplayName(value) === undefined) {
    ctx.addIssue({ code: "custom", message: "must contain displayable characters" });
  }
});

const sourceSchema = z
  .object({
    adapterId: identifierSchema,
    adapterVersion: identifierSchema,
    agentId: identifierSchema,
    agentName: nameSchema,
    agentVersion: identifierSchema.optional(),
  })
  .strict();

const sessionSchema = z
  .object({
    sessionId: identifierSchema,
    parentSessionId: identifierSchema.optional(),
    isSubagent: z.boolean().optional(),
    taskId: identifierSchema.optional(),
    projectId: identifierSchema.optional(),
    projectName: nameSchema.optional(),
    workingDirectory: identifierSchema.optional(),
  })
  .strict();

const detailsSchema = z
  .object({
    summaryCode: z.enum(SUMMARY_CODES).optional(),
    requestId: identifierSchema.optional(),
    completionScope: z.enum(["task", "session"]).optional(),
    resolution: z.enum(["approved", "denied", "unknown"]).optional(),
    resumeReason: z.enum(["input_provided", "new_prompt", "unknown"]).optional(),
    failureCode: z.enum(["host_error", "cancelled", "timeout", "unknown"]).optional(),
    turnDurationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const baseEventFields = {
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  eventId: identifierSchema,
  eventIdStability: z.enum(["source", "synthetic"]),
  dedupeKey: identifierSchema.optional(),
  sequence: z.number().int().nonnegative().optional(),
  source: sourceSchema,
  session: sessionSchema,
  occurredAt: timestampSchema,
  receivedAt: timestampSchema,
  confidence: z.enum(["authoritative", "inferred"]),
};

function optionalDetailsEvent(type: AgentEventType) {
  return z
    .object({
      ...baseEventFields,
      eventType: z.literal(type),
      details: detailsSchema.optional(),
    })
    .strict();
}

const eventSchema = z
  .discriminatedUnion("eventType", [
    optionalDetailsEvent("agent.started"),
    optionalDetailsEvent("agent.progress"),
    optionalDetailsEvent("agent.needs_input"),
    optionalDetailsEvent("agent.needs_approval"),
    z
      .object({
        ...baseEventFields,
        eventType: z.literal("agent.approval_resolved"),
        details: detailsSchema
          .extend({ resolution: z.enum(["approved", "denied", "unknown"]) })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...baseEventFields,
        eventType: z.literal("agent.resumed"),
        details: detailsSchema
          .extend({ resumeReason: z.enum(["input_provided", "new_prompt", "unknown"]) })
          .strict(),
      })
      .strict(),
    optionalDetailsEvent("agent.turn_ended"),
    z
      .object({
        ...baseEventFields,
        eventType: z.literal("agent.completed"),
        details: detailsSchema.extend({ completionScope: z.enum(["task", "session"]) }).strict(),
      })
      .strict(),
    z
      .object({
        ...baseEventFields,
        eventType: z.literal("agent.failed"),
        details: detailsSchema
          .extend({ failureCode: z.enum(["host_error", "cancelled", "timeout", "unknown"]) })
          .strict(),
      })
      .strict(),
    optionalDetailsEvent("agent.session_ended"),
    optionalDetailsEvent("agent.state_unknown"),
  ])
  .superRefine((event, ctx) => {
    if (event.eventIdStability === "synthetic" && event.dedupeKey === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["dedupeKey"],
        message: "synthetic events must supply dedupeKey",
      });
    }
  });

const REQUIRED_DETAILS: Partial<Record<AgentEventType, keyof AgentEventDetails>> = {
  "agent.approval_resolved": "resolution",
  "agent.resumed": "resumeReason",
  "agent.completed": "completionScope",
  "agent.failed": "failureCode",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathToString(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

function mapIssue(issue: z.core.$ZodIssue): ValidationIssue {
  if (issue.code === "unrecognized_keys") {
    const basePath = pathToString(issue.path);
    const key = issue.keys[0] ?? "";
    return {
      path: basePath.length > 0 ? `${basePath}.${key}` : key,
      code: "schema",
      message: issue.message,
    };
  }

  const path = pathToString(issue.path);
  const code =
    issue.code === "invalid_type" && (issue.expected === "object" || issue.expected === "array")
      ? "schema"
      : "invalid_field";

  return { path, code, message: issue.message };
}

/**
 * Validate an unknown payload against the agent event contract.
 * Never throws; all failures are reported as structured issues.
 */
export function parseAgentEvent(input: unknown): EventParseResult {
  try {
    if (!isRecord(input)) {
      return {
        ok: false,
        errors: [{ path: "", code: "schema", message: "event must be an object" }],
      };
    }

    if (input.schemaVersion !== EVENT_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          {
            path: "schemaVersion",
            code: "unsupported_version",
            message: `unsupported schemaVersion: expected ${EVENT_SCHEMA_VERSION}`,
          },
        ],
      };
    }

    const eventType = input.eventType;
    if (eventType === undefined) {
      return {
        ok: false,
        errors: [{ path: "eventType", code: "schema", message: "eventType is required" }],
      };
    }

    if (
      typeof eventType !== "string" ||
      !(AGENT_EVENT_TYPES as readonly string[]).includes(eventType)
    ) {
      return {
        ok: false,
        errors: [
          {
            path: "eventType",
            code: "unsupported_type",
            message: `unsupported eventType: ${String(eventType)}`,
          },
        ],
      };
    }

    const requiredField = REQUIRED_DETAILS[eventType as AgentEventType];
    if (requiredField !== undefined) {
      const details = input.details;
      if (details === undefined || (isRecord(details) && details[requiredField] === undefined)) {
        return {
          ok: false,
          errors: [
            {
              path: `details.${requiredField}`,
              code: "missing_details",
              message: `${eventType} requires details.${requiredField}`,
            },
          ],
        };
      }
    }

    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(mapIssue) };
    }

    return { ok: true, event: parsed.data };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          code: "schema",
          message: error instanceof Error ? error.message : "invalid event",
        },
      ],
    };
  }
}
