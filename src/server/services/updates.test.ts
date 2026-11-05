import { describe, expect, it } from "vitest";
import { updatePolicySchema, updaterTokenMatches } from "./updates";

describe("updaterTokenMatches", () => {
  it("accepts the configured token", () => {
    expect(updaterTokenMatches("a-long-shared-token", "a-long-shared-token")).toBe(true);
  });

  it("refuses a wrong, missing, or unconfigured token", () => {
    expect(updaterTokenMatches("wrong", "a-long-shared-token")).toBe(false);
    expect(updaterTokenMatches(null, "a-long-shared-token")).toBe(false);
    expect(updaterTokenMatches("anything", null)).toBe(false);
  });
});

describe("updatePolicySchema", () => {
  it("takes the three channels and an hour of the day", () => {
    expect(updatePolicySchema.parse({ channel: "development", updateHour: "3" })).toEqual({
      channel: "development",
      updateHour: 3,
    });
  });

  it("refuses anything else", () => {
    expect(() => updatePolicySchema.parse({ channel: "nightly" })).toThrow();
    expect(() => updatePolicySchema.parse({ updateHour: 24 })).toThrow();
    expect(() => updatePolicySchema.parse({ updateHour: 1.5 })).toThrow();
  });
});
