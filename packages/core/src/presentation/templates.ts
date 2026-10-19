/**
 * Notification templates and privacy modes (PRD.md §14.3, §17.3, F15).
 *
 * Every user-visible and spoken string comes from the fixed template set in
 * PRD §14.3. Rendering is pure and deterministic: the caller supplies the
 * already-formatted local `timeLabel`, so the core never reads a clock.
 *
 * Row selection order:
 * 1. Events with no channel mapping return `null` (PRD §14.1).
 * 2. `privacy.mode === "discreet"` uses the single discreet row.
 * 3. `coalescedCount` uses the coalesced row (it summarizes several events).
 * 4. `isReminder` uses the reminder row.
 * 5. Otherwise the row is keyed by `${eventType}:${completionScope ?? "session"}`.
 */

import { isVoiceSafeName, sanitizeDisplayName } from "@agent-attention/contract";
import type { AgentEventType, CompletionScope } from "@agent-attention/contract";

export type PrivacyMode = "standard" | "discreet";

export interface NotificationPrivacy {
  mode: PrivacyMode;
  showProjectName: boolean;
}

export interface RenderInput {
  eventType: AgentEventType;
  completionScope?: CompletionScope;
  isReminder?: boolean;
  agentName?: string;
  projectName?: string;
  timeLabel: string;
  privacy: NotificationPrivacy;
  coalescedCount?: number;
}

export interface RenderedNotification {
  title: string;
  body: string;
  speech: string;
}

interface TemplateRow {
  title: string;
  body: string;
  speech: string;
}

/** Rows that have a desktop/voice mapping in PRD §14.1. */
const NOTIFIABLE_EVENT_TYPES: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  "agent.needs_input",
  "agent.needs_approval",
  "agent.turn_ended",
  "agent.completed",
  "agent.failed",
]);

/** Exact PRD §14.3 strings. All standard rows share the same body shape. */
const TEMPLATES: Readonly<Record<string, TemplateRow>> = {
  "agent.needs_input:session": {
    title: "{agent} needs your input",
    body: "{project} · {time}",
    speech: "{agent} needs your input.",
  },
  "agent.needs_approval:session": {
    title: "{agent} needs approval",
    body: "{project} · {time}",
    speech: "{agent} is waiting for approval.",
  },
  "agent.turn_ended:session": {
    title: "{agent} stopped and is waiting for you",
    body: "{project} · {time}",
    speech: "{agent} stopped and is waiting for you.",
  },
  "agent.completed:task": {
    title: "{agent} completed a task",
    body: "{project} · {time}",
    speech: "{agent} completed a task.",
  },
  "agent.completed:session": {
    title: "{agent} finished",
    body: "{project} · {time}",
    speech: "{agent} has finished.",
  },
  "agent.failed:session": {
    title: "{agent} failed",
    body: "{project} · {time}",
    speech: "{agent} failed.",
  },
};

const REMINDER_TEMPLATE: TemplateRow = {
  title: "{agent} is still waiting",
  body: "{project} · {time}",
  speech: "{agent} is still waiting for you.",
};

const COALESCED_TEMPLATE: TemplateRow = {
  title: "{n} agents need your attention",
  body: "{time}",
  speech: "{n} agents need your attention.",
};

const DISCREET_TEMPLATE: TemplateRow = {
  title: "An agent needs attention",
  body: "{time}",
  speech: "An agent needs attention.",
};

/**
 * Removes an optional placeholder together with its separator when the value
 * is absent. A present value is substituted unchanged.
 */
function fillOptional(template: string, placeholder: string, value: string | undefined): string {
  if (value !== undefined) {
    return template.replaceAll(placeholder, value);
  }

  return template
    .replaceAll(`${placeholder} · `, "")
    .replaceAll(`${placeholder} `, "")
    .replaceAll(` ${placeholder}`, "")
    .replaceAll(placeholder, "");
}

function fillTemplate(
  template: string,
  values: { agent?: string; project?: string; timeLabel: string; count?: number },
): string {
  let rendered = fillOptional(template, "{agent}", values.agent);
  rendered = fillOptional(rendered, "{project}", values.project);
  rendered = rendered.replaceAll("{time}", values.timeLabel);

  if (values.count !== undefined) {
    rendered = rendered.replaceAll("{n}", String(values.count));
  }

  return rendered.trim();
}

function renderRow(
  row: TemplateRow,
  agent: string | undefined,
  project: string | undefined,
  timeLabel: string,
  count?: number,
): RenderedNotification {
  const values = { agent, project, timeLabel, ...(count !== undefined ? { count } : {}) };
  const speech =
    row.speech.includes("{agent}") && (agent === undefined || !isVoiceSafeName(agent))
      ? fillTemplate(DISCREET_TEMPLATE.speech, values)
      : fillTemplate(row.speech, values);

  return {
    title: fillTemplate(row.title, values),
    body: fillTemplate(row.body, values),
    speech,
  };
}

/**
 * Renders one notification from the fixed template set.
 *
 * Returns `null` for event types that have no desktop or voice channel
 * (PRD §14.1): `progress`, `state_unknown`, `started`, `resumed`,
 * `approval_resolved`, and `session_ended`.
 */
export function renderNotification(input: RenderInput): RenderedNotification | null {
  if (!NOTIFIABLE_EVENT_TYPES.has(input.eventType)) {
    return null;
  }

  if (input.privacy.mode === "discreet") {
    return renderRow(DISCREET_TEMPLATE, undefined, undefined, input.timeLabel);
  }

  const agent = input.agentName === undefined ? undefined : sanitizeDisplayName(input.agentName);
  const project =
    input.privacy.showProjectName && input.projectName !== undefined
      ? sanitizeDisplayName(input.projectName)
      : undefined;

  if (input.coalescedCount !== undefined) {
    return renderRow(
      COALESCED_TEMPLATE,
      undefined,
      undefined,
      input.timeLabel,
      input.coalescedCount,
    );
  }

  if (input.isReminder === true) {
    return renderRow(REMINDER_TEMPLATE, agent, project, input.timeLabel);
  }

  const scope =
    input.eventType === "agent.completed" ? (input.completionScope ?? "session") : "session";
  const row = TEMPLATES[`${input.eventType}:${scope}`];
  if (row === undefined) {
    return null;
  }

  return renderRow(row, agent, project, input.timeLabel);
}
