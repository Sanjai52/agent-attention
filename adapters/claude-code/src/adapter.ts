import type { AgentAttentionAdapter } from "@agent-attention/contract";
import { capabilitiesFor } from "./capabilities";
import { createNormalizer } from "./normalize";
import type { ClaudeCodeAdapterDependencies, ClaudeCodeHookEvent } from "./types";
import { CLAUDE_CODE_ADAPTER_ID, CLAUDE_CODE_ADAPTER_VERSION } from "./types";

export interface ClaudeCodeAdapter extends AgentAttentionAdapter { ingest(event: ClaudeCodeHookEvent): Promise<void>; }
export function createAdapter(deps: ClaudeCodeAdapterDependencies): ClaudeCodeAdapter {
  const capabilities = capabilitiesFor();
  const normalizer = createNormalizer({ capabilities, now: deps.now });
  let active = false;
  return { adapterId: CLAUDE_CODE_ADAPTER_ID, adapterVersion: CLAUDE_CODE_ADAPTER_VERSION, async start() { active = true; }, async stop() { active = false; }, getCapabilities() { return capabilities; }, async ingest(input) { if (!active) return; for (const event of normalizer.normalize(input)) { try { await deps.send(event); } catch (error) { deps.onError?.(error); } } } };
}
