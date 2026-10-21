import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { renderNotification } from "@agent-attention/core";
import { emit, buildHistoryReport, formatHistoryReport } from "@agent-attention/cli";
import {
  buildToastXml,
  createWindowsSoundProvider,
  createWindowsSpeechProvider,
} from "@agent-attention/platform-windows";
import { createFakeRunner, scriptResult } from "../platform-windows/fake-runner";

const HOSTILE_VALUES = [
  "quote\" apostrophe' ; `whoami` $(calc) %TEMP%",
  "<script>alert(1)</script> & <b>markup</b>",
  "\u0000\u0001\u001f\u007f\u009f\u202e\u2066rtl",
  `long-${"x".repeat(10_000)}`,
];

const SCRIPT_PATH = "C:\\app\\scripts\\fixed.ps1";

function renderedHostile(value: string) {
  return renderNotification({
    eventType: "agent.needs_input",
    agentName: value,
    projectName: value,
    timeLabel: "12:34",
    privacy: { mode: "standard", showProjectName: true },
  });
}

describe("security injection matrix", () => {
  it.each(HOSTILE_VALUES)(
    "keeps hostile names inert in templates, toast XML, TTS, history, CLI, and sound inputs: %j",
    async (hostile) => {
      const rendered = renderedHostile(hostile);
      expect(rendered).not.toBeNull();

      // Templates remove controls/bidi overrides and keep display text as data.
      for (const value of [rendered!.title, rendered!.body, rendered!.speech]) {
        // eslint-disable-next-line no-control-regex -- the matrix deliberately detects hostile controls
        expect(value).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
      }

      const toast = buildToastXml(rendered!.title, rendered!.body);
      expect(toast).not.toContain("<script>");
      expect(toast).not.toContain("<b>");
      expect(toast).toMatch(/^<toast>.*<\/toast>$/s);

      const speechRunner = createFakeRunner(() => scriptResult());
      const speech = createWindowsSpeechProvider({
        scriptPath: SCRIPT_PATH,
        runScript: speechRunner.run,
      });
      await speech.speak({ text: rendered!.speech, voiceId: null, volume: 50, rate: 0 });
      expect(speechRunner.calls).toHaveLength(1);
      expect(speechRunner.calls[0]!.options.stdin).toBe(rendered!.speech);
      expect(speechRunner.calls[0]!.options.args).toEqual(["-Rate", "0", "-Volume", "50"]);
      expect(speechRunner.calls[0]!.options.args.join(" ")).not.toContain(hostile);

      const history = buildHistoryReport({
        listEvents: () => [
          {
            eventId: "event-1",
            adapterId: hostile,
            sessionId: hostile,
            eventType: "agent.needs_input",
            confidence: "authoritative",
            occurredAt: "2026-10-21T00:00:00.000Z",
            receivedAt: "2026-10-21T00:00:00.000Z",
            late: false,
          },
        ],
        listDeliveries: () => [],
      });
      const json = JSON.stringify(history);
      expect(() => JSON.parse(json)).not.toThrow();
      expect(json).toContain(JSON.stringify(hostile));

      let stdout = "";
      emit(history, {
        json: false,
        io: {
          stdout: {
            write: (value: string) => {
              stdout += value;
            },
          },
          stderr: { write: () => {} },
        },
      });
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(formatHistoryReport(history)).toContain("agent.needs_input");

      const soundRunner = createFakeRunner(() => scriptResult());
      const sound = createWindowsSoundProvider({
        scriptsDir: "C:\\app\\scripts",
        soundsDir: "C:\\app\\sounds",
        runScript: soundRunner.run,
      });
      await sound.play({ soundId: hostile, volume: 50 });
      expect(soundRunner.calls[0]!.options.args).toEqual([
        "-Path",
        "C:\\app\\sounds\\attention.wav",
        "-Volume",
        "50",
      ]);
      expect(soundRunner.calls[0]!.options.args.join(" ")).not.toContain(hostile);
    },
  );

  it("keeps a hostile custom sound path in one argv element without shell expansion", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-attention-security-"));
    try {
      const hostilePath = path.join(directory, "sound;$(calc)%TEMP%&tag.wav");
      await writeFile(hostilePath, "RIFF");
      const runner = createFakeRunner(() => scriptResult());
      const sound = createWindowsSoundProvider({
        scriptsDir: "C:\\app\\scripts",
        runScript: runner.run,
      });

      await sound.play({ soundId: "attention", filePath: hostilePath, volume: 25 });

      expect(runner.calls[0]!.options.args).toEqual([
        "-Path",
        path.resolve(hostilePath),
        "-Volume",
        "25",
      ]);
      expect(runner.calls[0]!.options.args).toHaveLength(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
