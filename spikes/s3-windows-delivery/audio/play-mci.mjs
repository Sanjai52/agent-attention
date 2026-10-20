// Throwaway spike route B: Node-native playback through winmm MCI, no
// PowerShell and no shell. The WAV path is an app-controlled asset path, not
// event-derived text. Windows filenames cannot contain '"', so quoting the
// path inside the MCI command cannot be escaped by a filename.
// Usage: node play-mci.mjs <wavPath> [repeat]
import koffi from "koffi";

const [, , wavPath, repeatArg = "1"] = process.argv;
if (!wavPath) {
  console.error("usage: node play-mci.mjs <wavPath> [repeat]");
  process.exit(2);
}
const repeat = Number(repeatArg);

const winmm = koffi.load("winmm.dll");
const mciSendStringW = winmm.func(
  "uint32 __stdcall mciSendStringW(str16 cmd, void *ret, uint32 retLen, void *hwnd)",
);
const mciGetErrorStringW = winmm.func(
  "int __stdcall mciGetErrorStringW(uint32 err, _Out_ str16 buf, uint32 len)",
);

function mci(cmd) {
  const rc = mciSendStringW(cmd, null, 0, null);
  if (rc !== 0) {
    const buf = Buffer.alloc(512);
    mciGetErrorStringW(rc, buf, 256);
    throw new Error(`MCI ${rc}: ${buf.toString("utf16le").replace(/\0.*$/s, "")} (${cmd})`);
  }
}

const t0 = performance.now();
const alias = "spike";
const out = {
  route: "mci-koffi",
  path: wavPath,
  repeat,
  openMs: null,
  calls: [],
  totalMs: null,
  error: null,
};
let opened = false;
try {
  mci(`open "${wavPath}" type waveaudio alias ${alias}`);
  opened = true;
  out.openMs = Number((performance.now() - t0).toFixed(2));
  for (let i = 1; i <= repeat; i += 1) {
    const call = performance.now();
    mci(`play ${alias}`);
    out.calls.push({
      index: i,
      playCallMs: Number((performance.now() - call).toFixed(2)),
      sinceStartMs: Number((performance.now() - t0).toFixed(2)),
    });
    if (i === 1) {
      // Emitted immediately so the harness can timestamp spawn -> play accepted.
      console.log(`FIRST_PLAY_MS=${(performance.now() - t0).toFixed(2)}`);
    }
    if (i < repeat) {
      await new Promise((r) => setTimeout(r, 650));
    }
  }
  await new Promise((r) => setTimeout(r, 700));
} catch (err) {
  out.error = `${err.name}: ${err.message}`;
  process.stderr.write(out.error + "\n");
} finally {
  if (opened) {
    try {
      mci(`close ${alias}`);
    } catch {
      /* best effort */
    }
  }
  out.totalMs = Number((performance.now() - t0).toFixed(2));
  console.log(JSON.stringify(out));
}
