// Throwaway spike helper: write a deterministic PCM WAV tone.
// Usage: node gen-tone.mjs <outPath> [seconds] [freqHz]
import { writeFileSync } from "node:fs";

const [, , outPath, secondsArg = "0.6", freqArg = "660"] = process.argv;
if (!outPath) {
  console.error("usage: node gen-tone.mjs <outPath> [seconds] [freqHz]");
  process.exit(2);
}

const seconds = Number(secondsArg);
const freq = Number(freqArg);
const sampleRate = 44100;
const samples = Math.floor(sampleRate * seconds);
const dataBytes = samples * 2;

const header = Buffer.alloc(44);
header.write("RIFF", 0, "ascii");
header.writeUInt32LE(36 + dataBytes, 4);
header.write("WAVE", 8, "ascii");
header.write("fmt ", 12, "ascii");
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36, "ascii");
header.writeUInt32LE(dataBytes, 40);

const pcm = Buffer.alloc(dataBytes);
for (let i = 0; i < samples; i += 1) {
  // 20 ms fade in/out keeps the tone click-free.
  const t = i / sampleRate;
  const fade = Math.min(1, t / 0.02, (seconds - t) / 0.02);
  const value = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.25 * fade * 32767);
  pcm.writeInt16LE(value, i * 2);
}

writeFileSync(outPath, Buffer.concat([header, pcm]));
console.log(JSON.stringify({ outPath, seconds, freq, bytes: 44 + dataBytes }));
