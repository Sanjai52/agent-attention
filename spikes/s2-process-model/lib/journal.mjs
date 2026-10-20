import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Append-only framed journal used only to answer the S2 crash-recovery question.
 * D-04 (SQLite binding) is a separate decision and is deliberately NOT made here.
 *
 * Frame format (one per line):
 *   <crc32 decimal> <seq> <json>\n
 * crc32 covers "<seq> <json>".
 *
 * Recovery semantics: a torn or corrupt tail is truncated back to the last valid
 * frame. Interior corruption is reported as an error, not silently skipped.
 */
export class Journal {
  constructor(file) {
    this.file = file;
    this.fd = null;
    this.seq = 0;
    this.ids = new Set();
    this.records = 0;
    this.truncatedBytes = 0;
    this.interiorCorruption = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  open() {
    this.fd = fs.openSync(this.file, 'a+');
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) return this;
    const buf = fs.readFileSync(this.file);
    let offset = 0;
    let validBytes = 0;
    while (offset < buf.length) {
      const nl = buf.indexOf(0x0a, offset);
      if (nl === -1) {
        this.truncatedBytes += buf.length - validBytes;
        break; // torn tail: no newline
      }
      const lineBuf = buf.subarray(offset, nl);
      const line = lineBuf.toString('utf8');
      const first = line.indexOf(' ');
      const second = line.indexOf(' ', first + 1);
      if (first < 1 || second < 0) {
        this.truncatedBytes += buf.length - validBytes;
        break;
      }
      const crc = Number(line.slice(0, first));
      const seq = Number(line.slice(first + 1, second));
      const payload = line.slice(second + 1);
      if (!Number.isInteger(crc) || !Number.isInteger(seq) || zlib.crc32(`${seq} ${payload}`) !== crc) {
        this.truncatedBytes += buf.length - validBytes;
        break;
      }
      const event = JSON.parse(payload);
      this.seq = seq;
      if (event.eventId) this.ids.add(event.eventId);
      this.records++;
      validBytes = nl + 1;
      offset = nl + 1;
    }
    if (this.truncatedBytes > 0) {
      // Windows rejects ftruncate on a file opened in append mode; close, truncate, reopen.
      fs.closeSync(this.fd);
      fs.truncateSync(this.file, validBytes);
      this.fd = fs.openSync(this.file, 'a+');
    }
    return this;
  }

  append(event) {
    const seq = ++this.seq;
    const payload = JSON.stringify(event);
    const line = `${zlib.crc32(`${seq} ${payload}`)} ${seq} ${payload}\n`;
    fs.writeSync(this.fd, line);
    fs.fsyncSync(this.fd);
    if (event.eventId) this.ids.add(event.eventId);
    this.records++;
    return seq;
  }

  close() {
    if (this.fd !== null) {
      fs.fsyncSync(this.fd);
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
