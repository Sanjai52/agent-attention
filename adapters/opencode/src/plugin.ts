import { IPC_PROTOCOL_VERSION, type IpcRequest } from "@agent-attention/contract";
import { sendToHost } from "@agent-attention/shim";
import { Plugin } from "@opencode/plugin";

import { createAdapter } from "./adapter";
import type { AdapterHostApi, AdapterHostContext } from "./types";

function requestId(): string {
  return `opencode-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

export default Plugin.define({
  id: "agent-attention",
  async setup(ctx) {
    const context: AdapterHostContext = {
      app: { name: ctx.app.name, version: ctx.app.version },
      location: {
        directory: ctx.location.directory,
        ...(ctx.location.project === undefined
          ? {}
          : {
              project: {
                id: ctx.location.project.id,
                directory: ctx.location.project.directory,
                canonical: ctx.location.project.canonical,
              },
            }),
      },
    };

    const adapter = createAdapter({
      context,
      hostApi: { event: ctx.event as unknown as AdapterHostApi["event"] },
      send: async (event) => {
        const request: IpcRequest = {
          protocolVersion: IPC_PROTOCOL_VERSION,
          id: requestId(),
          kind: "submit_event",
          payload: { event },
        };
        await sendToHost(request);
      },
      onError: () => undefined,
    });

    await adapter.start();
    return () => adapter.stop();
  },
});
