/**
 * Adapter contract and capability declaration (PRD.md §16.2).
 *
 * The capability declaration is the only place an adapter claims support;
 * doctor, documentation, and metrics read from it.
 */

import type { AgentEventType } from "./events";

export type SupportLevel = "authoritative" | "inferred" | "unsupported";

export interface EventCapability {
  support: SupportLevel;
  sourceSignal?: string;
  verifiedAgainst?: string;
  notes?: string;
}

export interface AdapterCapabilities {
  adapterId: string;
  adapterVersion: string;
  hostVersionRange?: string;
  executionModel: "in_process_plugin" | "hook_process" | "extension";

  events: Record<AgentEventType, EventCapability>;

  eventIdsStable: boolean;
  supportsSequence: boolean;
  supportsTaskScope: boolean;
  supportsSubagents: boolean;
  supportsLiveness: boolean;
  supportsResolutionSignals: boolean;
}

export interface AgentAttentionAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getCapabilities(): AdapterCapabilities;
}
