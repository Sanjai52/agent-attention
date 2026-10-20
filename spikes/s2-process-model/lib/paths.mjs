import os from 'node:os';
import path from 'node:path';

export const PIPE_PREFIX = '\\\\.\\pipe\\';
const PIPE_BASE = 'agent-attention-';

export function userName() {
  return (process.env.USERNAME || os.userInfo().username || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');
}

export function pipeShortName(suffix = '') {
  return PIPE_BASE + userName() + (suffix ? `-${suffix}` : '');
}

export function pipePath(suffix = '') {
  return PIPE_PREFIX + pipeShortName(suffix);
}

export function dataRoot(override) {
  if (override) return path.resolve(override);
  if (process.env.AGENT_ATTENTION_DATA) return path.resolve(process.env.AGENT_ATTENTION_DATA);
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'AgentAttention');
}

export function paths(override) {
  const root = dataRoot(override);
  return {
    root,
    spoolDir: path.join(root, 'spool'),
    journal: path.join(root, 'host-journal.jsonl'),
    logsDir: path.join(root, 'logs'),
  };
}
