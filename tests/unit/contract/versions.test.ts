import { describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_VERSION, EVENT_SCHEMA_VERSION } from "@agent-attention/contract";

describe("contract version constants", () => {
  it("exposes the PRD event schema version", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(1);
  });

  it("exposes the PRD config schema version", () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(2);
  });
});
