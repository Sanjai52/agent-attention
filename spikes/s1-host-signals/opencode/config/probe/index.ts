// S1 throwaway probe plugin for OpenCode v2.0.32.
// Logs every plugin lifecycle/hook payload the host delivers to JSONL.
// This code is evidence-only and MUST NOT be promoted to a production adapter.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Plugin } from "@opencode/plugin";

const logPath = process.env.S1_PROBE_LOG ?? "s1-probe.jsonl";
mkdirSync(dirname(logPath), { recursive: true });

let sequence = 0;

function log(kind: string, payload: Record<string, unknown> = {}) {
  const record = {
    seq: ++sequence,
    ts: Date.now(),
    iso: new Date().toISOString(),
    kind,
    ...payload,
  };
  appendFileSync(logPath, JSON.stringify(record) + "\n");
}

function errorText(error: unknown) {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };
  return { value: String(error) };
}

export default Plugin.define({
  id: "s1-probe",
  async setup(ctx) {
    log("plugin.setup", {
      app: ctx.app,
      location: ctx.location,
      options: ctx.options,
      logPath,
    });

    // Documented session hook: log the mutable prompt-admission payload.
    const promptHook = await ctx.session.hook("prompt", (event) => {
      log("hook.session.prompt", { event });
    });

    const controller = new AbortController();
    const trackedSessions = new Set<string>();
    const pendingKeys = new Map<string, string>();
    const bindTimers = new Set<ReturnType<typeof setTimeout>>();
    let pollErrors = 0;

    const track = (sessionID: unknown) => {
      if (typeof sessionID === "string" && sessionID.startsWith("ses"))
        trackedSessions.add(sessionID);
    };

    const bindOutcome = (sessionID: string, trigger: string) => {
      const timer = setTimeout(() => {
        bindTimers.delete(timer);
        void (async () => {
          try {
            const messages = await ctx.session.context({ sessionID });
            const idle = messages.filter((message: { type?: string }) => message.type === "idle");
            const session = await ctx.session.get({ sessionID });
            log("session.outcome.binding", {
              trigger,
              sessionID,
              idleMessages: idle,
              sessionOutcome: session.outcome,
              sessionParentID: session.parentID,
              lastMessages: messages.slice(-3),
            });
          } catch (error) {
            log("session.outcome.binding.error", { trigger, sessionID, error: errorText(error) });
          }
        })();
      }, 150);
      bindTimers.add(timer);
    };

    // Documented plugin API: ctx.permission.list({ sessionID }). Polling records
    // whether a resolution can be inferred when no permission.replied event fires.
    const pendingTimer = setInterval(() => {
      for (const sessionID of trackedSessions) {
        void (async () => {
          try {
            const requests = await ctx.permission.list({ sessionID });
            const list = Array.isArray(requests) ? requests : [];
            const key = list
              .map((request: { id?: string }) => request.id ?? "?")
              .sort()
              .join(",");
            if (key !== pendingKeys.get(sessionID)) {
              pendingKeys.set(sessionID, key);
              log("permission.pending.snapshot", { sessionID, count: list.length, requests: list });
            }
          } catch (error) {
            pollErrors += 1;
            if (pollErrors <= 3)
              log("permission.pending.error", { sessionID, error: errorText(error), pollErrors });
          }
        })();
      }
    }, 250);

    void (async () => {
      try {
        log("event.stream.open");
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          log("event", { event });
          const data = (event as { data?: Record<string, unknown> }).data;
          track(data?.sessionID);
          if (typeof data?.sessionID === "string") {
            if (event.type === "session.idle") bindOutcome(data.sessionID, event.type);
            if (
              event.type === "session.execution.succeeded" ||
              event.type === "session.execution.failed" ||
              event.type === "session.execution.interrupted"
            ) {
              bindOutcome(data.sessionID, event.type);
            }
          }
        }
        log("event.stream.closed");
      } catch (error) {
        log("event.stream.error", { error: errorText(error) });
      }
    })();

    return () => {
      controller.abort();
      clearInterval(pendingTimer);
      for (const timer of bindTimers) clearTimeout(timer);
      void promptHook.dispose().catch(() => undefined);
      log("plugin.cleanup");
    };
  },
});
