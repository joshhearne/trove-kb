import { describe, expect, it } from "vitest";
import { presentedKey } from "./credentials";

const from = (headers: Record<string, string>) => presentedKey(new Headers(headers));

describe("presentedKey", () => {
  it("reads a key behind the Bearer scheme", () => {
    expect(from({ Authorization: "Bearer trove_abc123" })).toBe("trove_abc123");
  });

  it("reads a key given on its own", () => {
    expect(from({ Authorization: "trove_abc123" })).toBe("trove_abc123");
  });

  it("does not mind how Bearer is written or spaced", () => {
    expect(from({ Authorization: "bearer   trove_abc123  " })).toBe("trove_abc123");
    expect(from({ Authorization: "BEARER trove_abc123" })).toBe("trove_abc123");
  });

  it("reads X-API-Key when there is no Authorization", () => {
    expect(from({ "X-API-Key": " trove_abc123 " })).toBe("trove_abc123");
  });

  it("prefers Authorization to X-API-Key", () => {
    expect(from({ Authorization: "trove_one", "X-API-Key": "trove_two" })).toBe("trove_one");
  });

  it("takes no key from another scheme", () => {
    expect(from({ Authorization: "Basic dXNlcjpwYXNz" })).toBe("");
    expect(from({ Authorization: "Digest username=x" })).toBe("");
  });

  it("does not fall back to X-API-Key past an Authorization it could not read", () => {
    expect(from({ Authorization: "Basic dXNlcjpwYXNz", "X-API-Key": "trove_abc123" })).toBe("");
  });

  it("reads X-Auth-Token, bare or behind Bearer", () => {
    expect(from({ "X-Auth-Token": "trove_abc123" })).toBe("trove_abc123");
    expect(from({ "x-auth-token": " Bearer trove_abc123 " })).toBe("trove_abc123");
  });

  it("prefers X-Auth-Token to Authorization and X-API-Key", () => {
    expect(
      from({ "X-Auth-Token": "trove_one", Authorization: "Bearer host_token", "X-API-Key": "trove_three" }),
    ).toBe("trove_one");
  });

  it("takes no key from X-Auth-Token in another scheme, and does not fall back", () => {
    expect(from({ "X-Auth-Token": "Basic dXNlcjpwYXNz", Authorization: "trove_abc123" })).toBe("");
  });

  it("finds nothing where there is nothing", () => {
    expect(from({})).toBe("");
    expect(from({ Authorization: "   " })).toBe("");
    expect(from({ Authorization: "Bearer " })).toBe("Bearer");
  });
});
