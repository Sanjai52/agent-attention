import type { PreviewEventClass, PreviewRequest } from "@agent-attention/contract";

const EVENT_CLASSES = new Set<PreviewEventClass>(["needsInput", "needsApproval", "turnEnded", "completed", "failed"]);

export function parsePreviewArgs(args: string[]): PreviewRequest {
  const eventClass = args.find((item) => !item.startsWith("-")) as PreviewEventClass | undefined;
  if (eventClass === undefined || !EVENT_CLASSES.has(eventClass)) throw new Error("unknown preview event class");
  return { eventClass, channel: args.includes("--voice") ? "voice" : "sound", voice: args.includes("--voice") };
}
