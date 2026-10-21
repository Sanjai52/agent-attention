import type { AgentAttentionAdapter } from "@agent-attention/contract";
import { capabilitiesFor } from "./capabilities";
import { createNormalizer } from "./normalize/normalizer";
import type { AdapterDependencies } from "./types";
import { OPENCODE_ADAPTER_ID, OPENCODE_ADAPTER_VERSION } from "./types";

export function createAdapter(deps: AdapterDependencies): AgentAttentionAdapter {
  const normalizer = createNormalizer({ context: deps.context, capabilities: capabilitiesFor(deps.context.app.version), now: deps.now });
  let controller: AbortController | undefined;
  let consumePromise: Promise<void> | undefined;
  const consume = async (signal: AbortSignal): Promise<void> => {
    try {
      for await (const hostEvent of deps.hostApi.event.subscribe({ signal })) {
        if (signal.aborted) return;
        for (const event of normalizer.normalize(hostEvent)) {
          try { await deps.send(event); } catch (error) { deps.onError?.(error); }
        }
      }
    } catch (error) { if (!signal.aborted) deps.onError?.(error); }
  };
  return {
    adapterId: OPENCODE_ADAPTER_ID,
    adapterVersion: OPENCODE_ADAPTER_VERSION,
    async start() { if (controller !== undefined) return; controller = new AbortController(); consumePromise = consume(controller.signal); },
    async stop() { const activeController = controller; const activePromise = consumePromise; controller = undefined; consumePromise = undefined; if (activeController === undefined || activePromise === undefined) return; activeController.abort(); await activePromise; },
    getCapabilities() { return capabilitiesFor(deps.context.app.version); },
  };
}
