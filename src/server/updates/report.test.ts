import { describe, expect, it } from "vitest";
import { parseHostReport } from "./report";
import { getBuildInfo } from "./build-info";

function form(pairs: [string, string][]): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params;
}

describe("parseHostReport", () => {
  it("reads a routine report and leaves the pending set alone", () => {
    const { report, pending } = parseHostReport(
      form([
        ["status", "waiting"],
        ["message", "dev-abc1234 is available"],
        ["channel", "development"],
        ["mode", "docker"],
        ["available_version", "dev-abc1234"],
        ["handled_request", "0"],
      ]),
    );
    expect(report.status).toBe("waiting");
    expect(report.channel).toBe("development");
    expect(report.availableVersion).toBe("dev-abc1234");
    expect(report.handledRequest).toBe(false);
    expect(report.previousVersion).toBeNull();
    expect(pending).toBeNull();
  });

  it("refuses an unknown status", () => {
    expect(() => parseHostReport(form([["status", "exploded"]]))).toThrow();
  });

  it("drops a channel it does not know rather than storing it", () => {
    expect(parseHostReport(form([["status", "manual"], ["channel", "nightly"]])).report.channel).toBeNull();
  });

  it("clips long values", () => {
    const { report } = parseHostReport(form([["status", "failed"], ["message", "x".repeat(5000)]]));
    expect(report.message).toHaveLength(2000);
  });

  it("parses the change files a newer build brings", () => {
    const { pending } = parseHostReport(
      form([
        ["status", "waiting"],
        ["pending_changes_sent", "1"],
        ["pending_change", "kb-steps\n---\ntype: fix\naudience: everyone\n---\nSteps keep counting."],
        ["pending_change", "broken\nno front matter"],
        ["pending_changes_total", "5"],
      ]),
    );
    expect(pending?.entries).toEqual([
      { id: "kb-steps", kind: "fix", audience: "everyone", items: ["Steps keep counting."] },
    ]);
    expect(pending?.total).toBe(5);
  });

  it("treats an empty sent set as nothing coming", () => {
    const { pending } = parseHostReport(form([["status", "up_to_date"], ["pending_changes_sent", "1"]]));
    expect(pending).toEqual({ total: 0, entries: [] });
  });
});

describe("getBuildInfo", () => {
  it("uses the stamped build", () => {
    const info = getBuildInfo({
      TROVE_BUILD_VERSION: "dev-31327ac",
      TROVE_BUILD_COMMIT: "31327acca6109bc730719bc39337e983145e4a3e",
      TROVE_BUILT_AT: "2026-11-05T03:00:00Z",
    });
    expect(info.version).toBe("dev-31327ac");
    expect(info.development).toBe(true);
    expect(info.builtAt?.toISOString()).toBe("2026-11-05T03:00:00.000Z");
  });

  it("falls back to the package version", () => {
    const info = getBuildInfo({});
    expect(info.version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(info.commit).toBeNull();
    expect(info.builtAt).toBeNull();
  });
});
