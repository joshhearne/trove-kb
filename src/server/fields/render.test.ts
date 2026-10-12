import { describe, expect, it } from "vitest";
import { formatDate, renderFieldValue, renderMarkdown } from "./render";
import type { FieldDefinition, FieldType } from "./types";

function field(fieldType: FieldType): FieldDefinition {
  return {
    id: "f",
    label: "F",
    fieldType,
    optionListId: null,
    linkDocTypeId: null,
    required: false,
    sortOrder: 0,
    macFormat: null,
    archivedAt: null,
    docTypeId: "t",
    documentId: null,
  };
}

const labels = new Map([
  ["opt-a", "Fiber"],
  ["opt-b", "DSL"],
]);

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
  });

  it("strips embedded HTML that markdown lets through", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("script");
  });
});

describe("formatDate", () => {
  it("formats an ISO date in en-US without timezone drift", () => {
    expect(formatDate("2026-03-01")).toBe("Mar 1, 2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDate("nonsense")).toBe("nonsense");
  });
});

describe("renderFieldValue", () => {
  it("reports blanks as empty", () => {
    expect(renderFieldValue(field("text"), null, labels)).toEqual({ kind: "empty" });
    expect(renderFieldValue(field("text"), "", labels)).toEqual({ kind: "empty" });
  });

  it("renders booleans as Yes and No", () => {
    expect(renderFieldValue(field("boolean"), true, labels)).toEqual({ kind: "text", text: "Yes" });
    expect(renderFieldValue(field("boolean"), false, labels)).toEqual({ kind: "text", text: "No" });
  });

  it("formats numbers in en-US", () => {
    expect(renderFieldValue(field("number"), 1234567, labels)).toEqual({
      kind: "text",
      text: "1,234,567",
    });
  });

  it("resolves a dropdown id to its label", () => {
    expect(renderFieldValue(field("dropdown"), "opt-a", labels)).toEqual({
      kind: "text",
      text: "Fiber",
    });
  });

  it("resolves multi-select ids to labels", () => {
    expect(renderFieldValue(field("multi_dropdown"), ["opt-a", "opt-b"], labels)).toEqual({
      kind: "tags",
      labels: ["Fiber", "DSL"],
    });
  });

  it("drops option ids that no longer exist", () => {
    expect(renderFieldValue(field("dropdown"), "gone", labels)).toEqual({ kind: "empty" });
  });

  it("sanitizes richtext again on read", () => {
    const result = renderFieldValue(field("richtext"), '<p>hi</p><script>x</script>', labels);
    expect(result).toEqual({ kind: "html", html: "<p>hi</p>" });
  });

  it("renders a doc_link as the linked document", () => {
    const titles = new Map([["doc-1", "Acme Fiber"]]);
    expect(renderFieldValue(field("doc_link"), "doc-1", labels, titles)).toEqual({
      kind: "document",
      id: "doc-1",
      title: "Acme Fiber",
    });
  });

  it("renders a link to a document that no longer exists as empty", () => {
    expect(renderFieldValue(field("doc_link"), "gone", labels, new Map())).toEqual({
      kind: "empty",
    });
  });

  it("never renders a secret", () => {
    expect(renderFieldValue(field("secret_ref"), { itemId: "x" }, labels)).toEqual({
      kind: "empty",
    });
  });
});

describe("network values", () => {
  it("shows a single address with no block, legacy values included", () => {
    for (const stored of ["10.0.0.5/32", "10.0.0.5"]) {
      expect(renderFieldValue(field("ip"), stored, labels)).toMatchObject({
        kind: "ip",
        role: "address",
        address: "10.0.0.5",
        prefix: 32,
        addressKind: "host",
        block: null,
      });
    }
  });

  it("works out the block for an address on a subnet, and for a network", () => {
    const host = renderFieldValue(field("ip"), "192.168.1.10/24", labels);
    expect(host).toMatchObject({ role: "address", addressKind: "host_in_network" });
    expect(host.kind === "ip" && host.block?.network).toBe("192.168.1.0/24");

    const network = renderFieldValue(field("network"), "192.168.1.0/24", labels);
    expect(network).toMatchObject({
      kind: "ip",
      role: "network",
      block: { usable: "254", broadcast: "192.168.1.255", mask: "255.255.255.0" },
    });
  });

  it("shows a MAC address in the format in force now", () => {
    expect(
      renderFieldValue(field("mac"), "78:45:58:8A:DC:95", labels, new Map(), "en-US", "hyphen_lower"),
    ).toEqual({ kind: "mac", text: "78-45-58-8a-dc-95", locallyAdministered: false });
  });

  it("sizes a range", () => {
    expect(renderFieldValue(field("ip_range"), "10.0.0.100-10.0.0.199", labels)).toEqual({
      kind: "range",
      start: "10.0.0.100",
      end: "10.0.0.199",
      size: "100",
    });
  });
});

describe("IP address lists", () => {
  it("renders each address, keeping one that no longer parses as text", () => {
    expect(renderFieldValue(field("ip_list"), ["8.8.8.8/32", "nonsense"], labels)).toMatchObject({
      kind: "ip_list",
      items: [{ kind: "ip", address: "8.8.8.8", block: null }, { kind: "text", text: "nonsense" }],
    });
    expect(renderFieldValue(field("ip_list"), [], labels)).toEqual({ kind: "empty" });
  });
});

describe("ports", () => {
  it("renders a port with its service, and a range with its count", () => {
    expect(renderFieldValue(field("port"), "443/tcp", labels)).toEqual({
      kind: "port",
      value: "443/tcp",
      ports: "443",
      protocol: "tcp",
      service: "HTTPS",
      count: null,
    });
    expect(renderFieldValue(field("port_range"), "5060-5080/udp", labels)).toMatchObject({
      kind: "port",
      ports: "5060–5080",
      service: null,
      count: "21",
    });
  });
});
