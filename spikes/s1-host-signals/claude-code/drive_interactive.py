#!/usr/bin/env python
"""Throwaway S1 driver: run the real Claude Code TUI under a Windows pseudo-
console so permission dialogs can be answered like a user would.

Usage:
  python drive_interactive.py --prompt TOOL_OK --answer yes --out tui.log

Env is inherited (CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY,
PROBE_RUN_ID). Never modifies ~/.claude. The model is mocked by
mock-anthropic.cjs; the host, hooks, and permission dialog are real.
"""
import argparse
import os
import re
import sys
import threading
import time

from winpty import PtyProcess

CLAUDE_EXE = os.path.expandvars(
    r"%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
)

parser = argparse.ArgumentParser()
parser.add_argument("--prompt", required=True)
parser.add_argument("--answer", choices=["yes", "no"], default="yes")
parser.add_argument("--out", required=True)
parser.add_argument("--timeout", type=float, default=45.0)
parser.add_argument("--idle-wait", type=float, default=0.0)
args = parser.parse_args()

log_fh = open(args.out, "w", encoding="utf-8", errors="replace")


def record(text):
    log_fh.write(text)
    log_fh.flush()


buf = []
buf_lock = threading.Lock()
stop = threading.Event()

proc = PtyProcess.spawn(
    [CLAUDE_EXE, "--ax-screen-reader", "--permission-mode", "default"],
    cwd=os.getcwd(),
    env=os.environ.copy(),
    dimensions=(50, 140),
)


def reader():
    while not stop.is_set():
        try:
            data = proc.read(4096)
        except EOFError:
            break
        except Exception as exc:  # noqa: BLE001 - probe only
            buf.append(f"\n[reader error: {exc}]\n")
            break
        if not data:
            break
        with buf_lock:
            buf.append(data)
        record(data)


thread = threading.Thread(target=reader, daemon=True)
thread.start()


def screen():
    with buf_lock:
        return "".join(buf)


def send(text):
    proc.write(text)
    time.sleep(0.2)


def plain(text):
    # Strip ANSI/OSC sequences and control chars for matching.
    text = re.sub(r"\x1b\][^\x07]*\x07", "", text)
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
    text = re.sub(r"\x1b[()][A-Z0-9]", "", text)
    return text.replace("\r", "\n")


deadline = time.time() + args.timeout
sent_prompt = False
answered = False
trusted = False
exited = False
finished_at = None
start = time.time()

while time.time() < deadline:
    text = plain(screen())
    if finished_at is None and "probe-ok" in text or finished_at is None and "probe-plain-text" in text:
        finished_at = time.time()
    if not trusted and "Enter y/n" in text:
        send("y\r")
        trusted = True
    if "Enter to continue" in text and not answered:
        send("\r")
        time.sleep(0.5)
    if not sent_prompt and (trusted or time.time() - start > 6):
        send(args.prompt + "\r")
        sent_prompt = True
    if not answered and ("Do you want to proceed?" in text or "Yes" in text and "No" in text and "Bash" in text):
        time.sleep(0.5)
        # Escape cancels the dialog, which denies the request.
        send("\x1b" if args.answer == "no" else "1\r")
        answered = True
    if (
        finished_at is not None
        and time.time() - finished_at >= args.idle_wait
        and not exited
        and "Do you want to proceed?" not in text
    ):
        time.sleep(1.0)
        send("/exit\r")
        exited = True
    if exited and not proc.isalive():
        break
    if not proc.isalive():
        break
    time.sleep(0.2)

if proc.isalive():
    try:
        send("\x03")
        time.sleep(0.5)
        send("\x03")
    except Exception:  # noqa: BLE001
        pass
    time.sleep(1.0)

stop.set()
try:
    tail = proc.read(65536) if proc.isalive() else ""
except Exception:  # noqa: BLE001
    tail = ""
with buf_lock:
    final = "".join(buf) + (tail or "")

record(tail or "")
log_fh.close()

print(plain(final)[-4000:])
print(f"\n[driver] answered={answered} exited={exited} alive={proc.isalive()}")
