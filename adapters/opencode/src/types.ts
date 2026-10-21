/**
 * OpenCode adapter types and constants (Phase 3, Stream A).
 *
 * The adapter observes the in-process plugin event stream and normalizes only
 * verified host signals. `OpenCodeEvent` mirrors the envelope fields the
 * adapter reads; payload fields are deliberately not modeled beyond `data` so
 * normalizers cannot accidentally pass host payloads through.
 */

import type { AgentEvent } from "@agent-attention/contract";

export const OPENCODE_ADAPTER_ID = "opencode";
export const OPENCODE_ADAPTER_VERSION = "0.0.0";

/** Host range covered by the frozen v2.0.32 evidence. */
export const OPENCODE_HOST_VERSION_RANGE = ">=2.0.32 <2.1.0";

export interface OpenCodeDurable {
  aggregateID: string;
  seq: number;
  version: number;
}

export interface OpenCodeEvent {
  id: string;
  created: number;
  type: string;
  durable?: OpenCodeDurable;
  location?: { directory: string };
  data?: Record<string, unknown>;
}

export interface AdapterHostContext {
  app: { name: string; version: string };
  location: {
    directory: string;
    project?: { id: string; directory: string; canonical?: string };
  };
}

export interface AdapterHostApi {
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<OpenCodeEvent>;
  };
}

export interface AdapterDependencies {
  send: (event: AgentEvent) => Promise<void>;
  hostApi: AdapterHostApi;
  context: AdapterHostContext;
  now?: () => number;
  onError?: (error: unknown) => void;
}
