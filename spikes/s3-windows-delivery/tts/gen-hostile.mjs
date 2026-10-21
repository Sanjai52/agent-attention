// Throwaway spike helper: write the hostile TTS test string as exact UTF-8
// bytes, with no BOM and no trailing newline. Includes the required
// `"; rm -rf ~ #` payload, PowerShell injection canaries, and bidi overrides.
import { writeFileSync, mkdirSync } from "node:fs";

const outDir = process.argv[2] ?? "out";
mkdirSync(outDir, { recursive: true });

const lines = [
  '"; rm -rf ~ #',
  '"; Set-Content -Path canary-pwned.txt -Value PWNED; # $(Get-Process) `whoami`',
  "Hello \u202Eevil\u202D project \u2066name\u2069 \u202Btrail",
];
const text = lines.join("\n");
const path = `${outDir}/hostile-tts.txt`;
writeFileSync(path, text, "utf8");
console.log(JSON.stringify({ path, chars: text.length }));
