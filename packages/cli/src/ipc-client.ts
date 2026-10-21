import { randomUUID } from "node:crypto";
import { requestToHost, resolvePipeName, type SendToHostOptions } from "@agent-attention/shim";
import type { IpcRequest, IpcResponse, IpcRequestKind, RequestPayloads } from "@agent-attention/contract";

export interface IpcClient {
  request<K extends IpcRequestKind>(kind: K, payload: RequestPayloads[K]): Promise<IpcResponse>;
}

export interface IpcClientOptions extends SendToHostOptions {
  pipeName?: string;
  request?: (request: IpcRequest, options: SendToHostOptions) => Promise<IpcResponse>;
}

export function createIpcClient(options: IpcClientOptions = {}): IpcClient {
  const request = options.request ?? requestToHost;
  return {
    request: (kind, payload) => request({
      protocolVersion: 1,
      id: randomUUID(),
      kind,
      payload,
    } as IpcRequest, options),
  };
}

export function defaultIpcOptions(env: NodeJS.ProcessEnv = process.env): SendToHostOptions {
  return { pipeName: resolvePipeName(env) };
}
