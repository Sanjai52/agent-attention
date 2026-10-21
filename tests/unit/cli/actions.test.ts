import { describe, expect, it } from "vitest";
import { parseMuteDuration } from "../../../packages/cli/src/commands/mute";
import { parsePreviewArgs } from "../../../packages/cli/src/commands/preview";

describe("CLI action requests", () => {
  it("parses preview voice requests", () => {
    expect(parsePreviewArgs(["needsApproval", "--voice"])).toEqual({ eventClass: "needsApproval", channel: "voice", voice: true });
  });
  it("rejects zero mute duration", () => {
    expect(() => parseMuteDuration("0s")).toThrow();
  });
});
