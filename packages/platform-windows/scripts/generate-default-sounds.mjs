#!/usr/bin/env node
/* global Buffer, console */
// Generates the bundled default notification WAVs. Run from the package root:
//   node scripts/generate-default-sounds.mjs
//
// Format: PCM, mono, 22050 Hz, 16-bit little-endian, short fades to avoid
// clicks. The committed files are intentionally small (all five are < 100 KB).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 22_050;
const AMPLITUDE = 0.28;
const FADE_SECONDS = 0.006;

function tone(frequency, seconds) {
  const count = Math.round(SAMPLE_RATE * seconds);
  const fade = Math.max(1, Math.round(SAMPLE_RATE * FADE_SECONDS));
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    const envelope = Math.min(1, i / fade, (count - 1 - i) / fade);
    samples[i] = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) *
        AMPLITUDE *
        envelope *
        32_767,
    );
  }
  return samples;
}

function silence(seconds) {
  return new Int16Array(Math.round(SAMPLE_RATE * seconds));
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const samples = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length;
  }
  return samples;
}

function wav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

const sounds = {
  attention: concat([tone(660, 0.12), silence(0.04), tone(880, 0.16)]),
  approval: concat([
    tone(523.25, 0.1),
    silence(0.03),
    tone(659.25, 0.1),
    silence(0.03),
    tone(783.99, 0.16),
  ]),
  idle: concat([tone(440, 0.16)]),
  complete: concat([tone(523.25, 0.12), silence(0.03), tone(783.99, 0.18)]),
  failure: concat([tone(330, 0.14), silence(0.04), tone(220, 0.22)]),
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "..", "assets", "sounds");
await mkdir(outputDir, { recursive: true });

for (const [name, samples] of Object.entries(sounds)) {
  const file = path.join(outputDir, `${name}.wav`);
  const buffer = wav(samples);
  await writeFile(file, buffer);
  console.log(`${name}.wav ${buffer.length} bytes`);
}
