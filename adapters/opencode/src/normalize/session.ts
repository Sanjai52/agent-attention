import type { AgentEventSession } from "@agent-attention/contract";
import type { AdapterHostContext, OpenCodeEvent } from "../types";
import { readString, sessionIdOf } from "./common";

interface SessionState { projectId?: string; projectName?: string; workingDirectory?: string; parentSessionId?: string; terminal?: boolean; }
function projectName(directory: string | undefined): string | undefined { const value = directory?.replace(/[\\/]+$/, ""); const name = value?.split(/[\\/]/).at(-1); return name || undefined; }

export class SessionTracker {
  readonly #sessions = new Map<string, SessionState>();
  readonly #seen = new Set<string>();
  hasSeen(id: string): boolean { return this.#seen.has(id); }
  markSeen(id: string): void { this.#seen.add(id); }
  observe(event: OpenCodeEvent): string | undefined {
    const id = sessionIdOf(event); if (id === undefined) return undefined;
    const data = event.data; const state = this.#sessions.get(id) ?? {};
    const location = data?.location; const locationRecord = typeof location === "object" && location !== null && !Array.isArray(location) ? location as Record<string, unknown> : undefined;
    const directory = readString(locationRecord, "directory") ?? event.location?.directory;
    const projectDirectory = readString(data, "projectDirectory");
    const parentSessionId = readString(data, "parentID");
    const projectId = readString(data, "projectID");
    this.#sessions.set(id, { ...state, ...(projectId ? { projectId } : {}), ...(projectDirectory ? { projectName: projectName(projectDirectory) } : {}), ...(directory ? { workingDirectory: directory } : {}), ...(parentSessionId ? { parentSessionId } : {}) });
    return id;
  }
  markTerminal(id: string): boolean { const state = this.#sessions.get(id) ?? {}; if (state.terminal) return false; this.#sessions.set(id, { ...state, terminal: true }); return true; }
  session(event: OpenCodeEvent, context: AdapterHostContext): AgentEventSession | undefined {
    const id = sessionIdOf(event); if (id === undefined) return undefined;
    const state = this.#sessions.get(id) ?? {}; const project = context.location.project; const name = state.projectName ?? projectName(project?.directory);
    return { sessionId: id, ...(state.parentSessionId ? { parentSessionId: state.parentSessionId, isSubagent: true } : {}), ...((state.projectId ?? project?.id) ? { projectId: state.projectId ?? project?.id } : {}), ...(name ? { projectName: name } : {}), ...(state.workingDirectory ?? event.location?.directory ?? context.location.directory ? { workingDirectory: state.workingDirectory ?? event.location?.directory ?? context.location.directory } : {}) };
  }
}
