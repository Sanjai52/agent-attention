import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pipePath } from './lib/paths.mjs';

const { values: args } = parseArgs({
  options: {
    'pipe-suffix': { type: 'string', default: '' },
    count: { type: 'string', default: '1' },
    kind: { type: 'string', default: 'progress' },
    session: { type: 'string', default: 'client-session' },
    seq: { type: 'string', default: '1' },
    out: { type: 'string' },
    'timeout-ms': { type: 'string', default: '3000' },
    ping: { type: 'boolean', default: false },
    shutdown: { type: 'boolean', default: false },
  },
});

const pipe = pipePath(args['pipe-suffix']);
const count = Number(args.count);
const timeoutMs = Number(args['timeout-ms']);
const rows = [];

function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('connect timeout')); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function send(socket, message) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('ack timeout')), timeoutMs);
    const onData = (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      socket.off('data', onData);
      try { resolve(JSON.parse(buf.slice(0, nl))); } catch (err) { reject(err); }
    };
    socket.on('data', onData);
    socket.write(JSON.stringify(message) + '\n');
  });
}

const socket = await connect().catch((err) => { process.stderr.write(`connect failed: ${err.message}\n`); process.exit(2); });

try {
  if (args.ping) {
    const t = performance.now();
    const pong = await send(socket, { type: 'ping' });
    rows.push({ type: 'pong', rttMs: Number((performance.now() - t).toFixed(3)), ...pong });
  } else if (args.shutdown) {
    rows.push(await send(socket, { type: 'shutdown' }));
  } else {
    const base = Number(args.seq);
    for (let i = 0; i < count; i++) {
      const event = {
        eventId: randomUUID(),
        sessionId: args.session,
        kind: args.kind,
        sequence: base + i,
        ts: Date.now(),
        source: 's2-client',
      };
      const t = performance.now();
      const ack = await send(socket, { type: 'event', event });
      rows.push({ ...ack, rttMs: Number((performance.now() - t).toFixed(3)) });
    }
  }
} finally {
  socket.destroy();
}

const out = rows.map((r) => JSON.stringify(r)).join('\n');
if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), out + '\n');
} else {
  process.stdout.write(out + '\n');
}
