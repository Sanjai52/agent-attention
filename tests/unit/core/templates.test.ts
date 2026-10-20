import type { AgentEventType } from "@agent-attention/contract";
import type { RenderInput, RenderedNotification } from "@agent-attention/core";
import { renderNotification } from "@agent-attention/core";
import { describe, expect, it } from "vitest";

const STANDARD_PRIVACY: RenderInput["privacy"] = {
  mode: "standard",
  showProjectName: true,
};

const FULL_INPUT: RenderInput = {
  eventType: "agent.needs_input",
  agentName: "Claude Code",
  projectName: "agent-attention",
  timeLabel: "14:05",
  privacy: STANDARD_PRIVACY,
};

function render(overrides: Partial<RenderInput> = {}): RenderedNotification | null {
  return renderNotification({ ...FULL_INPUT, ...overrides });
}

describe("renderNotification template rows (PRD §14.3)", () => {
  it.each<{
    name: string;
    input: Partial<RenderInput>;
    expected: RenderedNotification;
  }>([
    {
      name: "needs_input",
      input: { eventType: "agent.needs_input" },
      expected: {
        title: "Claude Code needs your input",
        body: "agent-attention · 14:05",
        speech: "Claude Code needs your input.",
      },
    },
    {
      name: "needs_approval",
      input: { eventType: "agent.needs_approval" },
      expected: {
        title: "Claude Code needs approval",
        body: "agent-attention · 14:05",
        speech: "Claude Code is waiting for approval.",
      },
    },
    {
      name: "turn_ended",
      input: { eventType: "agent.turn_ended" },
      expected: {
        title: "Claude Code stopped and is waiting for you",
        body: "agent-attention · 14:05",
        speech: "Claude Code stopped and is waiting for you.",
      },
    },
    {
      name: "completed (task)",
      input: { eventType: "agent.completed", completionScope: "task" },
      expected: {
        title: "Claude Code completed a task",
        body: "agent-attention · 14:05",
        speech: "Claude Code completed a task.",
      },
    },
    {
      name: "completed (session)",
      input: { eventType: "agent.completed", completionScope: "session" },
      expected: {
        title: "Claude Code finished",
        body: "agent-attention · 14:05",
        speech: "Claude Code has finished.",
      },
    },
    {
      name: "failed",
      input: { eventType: "agent.failed" },
      expected: {
        title: "Claude Code failed",
        body: "agent-attention · 14:05",
        speech: "Claude Code failed.",
      },
    },
    {
      name: "reminder",
      input: { eventType: "agent.needs_input", isReminder: true },
      expected: {
        title: "Claude Code is still waiting",
        body: "agent-attention · 14:05",
        speech: "Claude Code is still waiting for you.",
      },
    },
    {
      name: "coalesced",
      input: { eventType: "agent.needs_input", coalescedCount: 3 },
      expected: {
        title: "3 agents need your attention",
        body: "14:05",
        speech: "3 agents need your attention.",
      },
    },
    {
      name: "discreet mode",
      input: { privacy: { mode: "discreet", showProjectName: true } },
      expected: {
        title: "An agent needs attention",
        body: "14:05",
        speech: "An agent needs attention.",
      },
    },
  ])("renders the $name row exactly", ({ input, expected }) => {
    expect(render(input)).toEqual(expected);
  });

  it("defaults completed without a scope to the session row", () => {
    expect(render({ eventType: "agent.completed" })).toEqual({
      title: "Claude Code finished",
      body: "agent-attention · 14:05",
      speech: "Claude Code has finished.",
    });
  });

  it("uses the caller-formatted time label verbatim", () => {
    expect(render({ timeLabel: "9:05 PM" })?.body).toBe("agent-attention · 9:05 PM");
  });

  it("never claims success or completion for turn_ended (AC-F10-01, F10-R2)", () => {
    const rendered = render({ eventType: "agent.turn_ended", projectName: undefined });
    expect(rendered).not.toBeNull();

    const successWords = /\b(complet|finish|success|succeed|done|task)\w*/i;
    expect(rendered?.title).not.toMatch(successWords);
    expect(rendered?.speech).not.toMatch(successWords);
    expect(rendered?.title).toContain("stopped and is waiting for you");
    expect(rendered?.speech).toContain("stopped and is waiting for you");
  });
});

describe("row selection precedence", () => {
  it("lets coalescedCount take precedence over the event template", () => {
    expect(
      render({
        eventType: "agent.completed",
        completionScope: "task",
        coalescedCount: 2,
      }),
    ).toEqual({
      title: "2 agents need your attention",
      body: "14:05",
      speech: "2 agents need your attention.",
    });
  });

  it("lets coalescedCount take precedence over the reminder row", () => {
    expect(render({ eventType: "agent.needs_input", isReminder: true, coalescedCount: 4 })).toEqual(
      {
        title: "4 agents need your attention",
        body: "14:05",
        speech: "4 agents need your attention.",
      },
    );
  });

  it("uses the discreet row for every notification, including reminders and coalescing", () => {
    const discreet = { mode: "discreet", showProjectName: true } as const;
    const eventTypes: AgentEventType[] = [
      "agent.needs_input",
      "agent.needs_approval",
      "agent.turn_ended",
      "agent.completed",
      "agent.failed",
    ];
    const expected: RenderedNotification = {
      title: "An agent needs attention",
      body: "14:05",
      speech: "An agent needs attention.",
    };

    for (const eventType of eventTypes) {
      expect(render({ eventType, privacy: discreet })).toEqual(expected);
    }
    expect(render({ eventType: "agent.needs_input", isReminder: true, privacy: discreet })).toEqual(
      expected,
    );
    expect(
      render({ eventType: "agent.needs_input", coalescedCount: 5, privacy: discreet }),
    ).toEqual(expected);
  });
});

describe("privacy and safe names", () => {
  it("omits the project and separator when the project name is missing", () => {
    expect(render({ projectName: undefined })?.body).toBe("14:05");
    expect(render({ projectName: "" })?.body).toBe("14:05");
  });

  it("omits the project and separator when the project is hidden by privacy settings", () => {
    expect(render({ privacy: { mode: "standard", showProjectName: false } })?.body).toBe("14:05");
  });

  it("strips a bidi override from a covert agent name (AC-F15-01)", () => {
    const rendered = render({ agentName: "pro\u202Eject" });
    expect(rendered).toEqual({
      title: "project needs your input",
      body: "agent-attention · 14:05",
      speech: "project needs your input.",
    });
    expect(rendered?.title).not.toContain("\u202E");
  });

  it("keeps a hostile project in the body as inert text but never in speech (AC-F5-06)", () => {
    const rendered = render({ projectName: "; rm -rf ~ #" });
    expect(rendered?.body).toBe("; rm -rf ~ # · 14:05");
    expect(rendered?.speech).not.toContain("rm -rf");
    expect(rendered?.speech).toBe("Claude Code needs your input.");
  });

  it("omits an unsafe agent name from speech and uses the discreet wording instead", () => {
    const rendered = render({ agentName: "Claude<script>" });
    expect(rendered?.title).toBe("Claude<script> needs your input");
    expect(rendered?.speech).toBe("An agent needs attention.");
    expect(rendered?.speech).not.toContain("Claude");
    expect(rendered?.speech).not.toContain("<");
  });

  it("omits a missing agent name from the title and uses discreet speech", () => {
    const rendered = render({ agentName: undefined });
    expect(rendered?.title).toBe("needs your input");
    expect(rendered?.speech).toBe("An agent needs attention.");
  });

  it("treats a control-only agent name as missing", () => {
    const rendered = render({ agentName: "\u0000\u202E" });
    expect(rendered?.title).toBe("needs your input");
    expect(rendered?.speech).toBe("An agent needs attention.");
  });

  it("uses discreet speech for an unsafe name on the reminder row", () => {
    const rendered = render({ isReminder: true, agentName: "Claude; notify-send" });
    expect(rendered?.title).toBe("Claude; notify-send is still waiting");
    expect(rendered?.speech).toBe("An agent needs attention.");
  });
});

describe("events without a notification channel (PRD §14.1)", () => {
  const unMapped: AgentEventType[] = [
    "agent.progress",
    "agent.state_unknown",
    "agent.started",
    "agent.resumed",
    "agent.approval_resolved",
    "agent.session_ended",
  ];

  it.each(unMapped)("returns null for %s", (eventType) => {
    expect(render({ eventType })).toBeNull();
  });
});
