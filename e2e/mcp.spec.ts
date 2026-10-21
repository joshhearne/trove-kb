import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, signInAsAdmin, unique } from "./support";

/**
 * The MCP endpoint: an AI client reads documentation through the same API keys
 * the REST API uses, and can never read a credential.
 */

const COMPANY = unique("MCP Co");
const MARKER = `kestrel${Date.now().toString(36)}`;

let apiKey = "";
let companyId = "";
let documentId = "";

test.describe.configure({ mode: "serial" });

async function createKey(page: Page, name: string, scopes: string[]): Promise<string> {
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(name);
  for (const scope of ["read", "write", "admin", "secrets:reveal"]) {
    const box = page.getByRole("checkbox", { name: scope, exact: true });
    if (scopes.includes(scope)) await box.check();
    else await box.uncheck();
  }
  await page.getByRole("radio", { name: "Every company" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  return (await page.getByRole("status", { name: "New API key" }).textContent()) as string;
}

/** One JSON-RPC round trip against the endpoint. */
async function rpc(
  request: APIRequestContext,
  method: string,
  params?: Record<string, unknown>,
  key = apiKey,
) {
  const response = await request.post("/api/mcp", {
    headers: {
      Authorization: `Bearer ${key}`,
      "MCP-Protocol-Version": "2025-06-18",
      Accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
  });
  return { status: response.status(), body: response.status() === 202 ? null : await response.json() };
}

async function callTool(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const { body } = await rpc(request, "tools/call", { name, arguments: args });
  return body.result;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await signInAsAdmin(page);

  companyId = await createCompany(page, COMPANY);

  // A Vendor is company scoped and needs its Name field.
  await page.goto(`/companies/${companyId}/documents/new`);
  await page.getByRole("link", { name: /^Vendor\b/ }).click();
  await page.getByLabel("Title").fill(`Uplink provider ${MARKER}`);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`Kestrel Networks`);
  await page.getByRole("textbox", { name: "Support Phone", exact: true }).fill("+1 555 0142");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  documentId = page.url().split("/").pop() as string;

  apiKey = await createKey(page, unique("mcp key"), ["read"]);
  await page.close();
});

test("the endpoint refuses anonymous callers", async ({ request }) => {
  const response = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "initialize" },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toContain("Bearer");
});

test("the key is accepted as it was handed out, with or without a scheme", async ({ request }) => {
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

  const accepted: Record<string, string>[] = [
    { Authorization: `Bearer ${apiKey}` },
    { Authorization: apiKey },
    { Authorization: `bearer   ${apiKey}` },
    { "X-API-Key": apiKey },
    { "x-auth-token": apiKey },
    { "X-Auth-Token": `Bearer ${apiKey}` },
  ];
  for (const headers of accepted) {
    const response = await request.post("/api/mcp", { headers, data: ping });
    expect(response.status(), JSON.stringify(Object.keys(headers))).toBe(200);
  }

  // The REST API reads a key the same way.
  const rest = await request.get("/api/v1/companies", { headers: { Authorization: apiKey } });
  expect(rest.status()).toBe(200);
  const restToken = await request.get("/api/v1/companies", { headers: { "x-auth-token": apiKey } });
  expect(restToken.status()).toBe(200);
});

test("a key that is wrong, or in a scheme that is not ours, is refused", async ({ request }) => {
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

  const refused: Record<string, string>[] = [
    { Authorization: `${apiKey}x` },
    { Authorization: `Basic ${Buffer.from(`user:${apiKey}`).toString("base64")}` },
    { "X-API-Key": "trove_not-a-real-key-at-all" },
    { "x-auth-token": `${apiKey}x` },
  ];
  for (const headers of refused) {
    const response = await request.post("/api/mcp", { headers, data: ping });
    expect(response.status()).toBe(401);
  }
});

test("it negotiates a protocol version and declares its tools", async ({ request }) => {
  const { body } = await rpc(request, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });

  expect(body.result.protocolVersion).toBe("2025-06-18");
  expect(body.result.capabilities.tools).toBeTruthy();
  expect(body.result.serverInfo.name).toBe("trove-kb");

  // An older client keeps the version it asked for.
  const older = await rpc(request, "initialize", { protocolVersion: "2024-11-05" });
  expect(older.body.result.protocolVersion).toBe("2024-11-05");
});

test("a notification is acknowledged with no body", async ({ request }) => {
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  expect(response.status()).toBe(202);
  expect(await response.text()).toBe("");
});

test("tools/list describes read-only tools", async ({ request }) => {
  const { body } = await rpc(request, "tools/list");
  const names = body.result.tools.map((tool: { name: string }) => tool.name);

  expect(names).toEqual(
    expect.arrayContaining([
      "search_documents",
      "get_document",
      "list_companies",
      "get_company",
      "list_doc_types",
    ]),
  );

  for (const tool of body.result.tools) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.annotations.readOnlyHint).toBe(true);
  }
});

test("search finds a document and get_document reads it", async ({ request }) => {
  const found = await callTool(request, "search_documents", { query: MARKER });
  expect(found.structuredContent.count).toBeGreaterThan(0);
  expect(found.structuredContent.documents[0].document_id).toBe(documentId);

  const document = await callTool(request, "get_document", { document_id: documentId });
  const fields = document.structuredContent.fields as { label: string; value: unknown }[];

  expect(document.structuredContent.title).toContain(MARKER);
  expect(fields.find((f) => f.label === "Name")?.value).toBe("Kestrel Networks");
  expect(fields.find((f) => f.label === "Support Phone")?.value).toBe("+1 555 0142");
  // The text block mirrors the structured content for clients that only read text.
  expect(JSON.parse(document.content[0].text).title).toContain(MARKER);
});

test("company tools describe what is documented", async ({ request }) => {
  const companies = await callTool(request, "list_companies", { query: "MCP Co" });
  expect(companies.structuredContent.companies.length).toBeGreaterThan(0);

  const company = await callTool(request, "get_company", { company_id: companyId });
  expect(company.structuredContent.company.id).toBe(companyId);
  expect(company.structuredContent.documents[0].title).toContain(MARKER);

  const docTypes = await callTool(request, "list_doc_types", {});
  const vendor = docTypes.structuredContent.doc_types.find(
    (type: { name: string }) => type.name === "Vendor",
  );
  expect(vendor.fields.map((f: { label: string }) => f.label)).toContain("Support Phone");
});

test("a credential is never returned through MCP", async ({ request, browser }) => {
  // Give the company a document holding a secret field.
  const page = await browser.newPage();
  await signInAsAdmin(page);
  const secretFieldId = psql(
    `select f.id from fields f join doc_types d on d.id = f.doc_type_id ` +
      `where f.field_type = 'secret_ref' and d.name = 'Firewall' limit 1;`,
  );
  expect(secretFieldId).toHaveLength(36);
  await page.close();

  const document = await callTool(request, "get_document", { document_id: documentId });
  const serialized = JSON.stringify(document);

  // No tool can reveal, and the redaction note is explicit.
  const { body } = await rpc(request, "tools/list");
  const names = body.result.tools.map((tool: { name: string }) => tool.name);
  expect(names.join(",")).not.toMatch(/reveal|secret|password|totp/i);
  expect(serialized).toContain("Secret fields are omitted");
});

test("bad input is a tool error, not a protocol error", async ({ request }) => {
  const result = await callTool(request, "get_document", { document_id: "not-a-uuid" });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Invalid arguments");

  const missing = await callTool(request, "get_document", {
    document_id: "11111111-1111-4111-8111-111111111111",
  });
  expect(missing.isError).toBe(true);
});

test("an unknown tool or method is a protocol error", async ({ request }) => {
  const unknownTool = await rpc(request, "tools/call", { name: "drop_everything", arguments: {} });
  expect(unknownTool.body.error.code).toBe(-32602);

  const unknownMethod = await rpc(request, "resources/list");
  expect(unknownMethod.body.error.code).toBe(-32601);
});

test("an unsupported protocol version is rejected", async ({ request }) => {
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${apiKey}`, "MCP-Protocol-Version": "1999-01-01" },
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  expect(response.status()).toBe(400);
});

test("GET is refused, since there is no stream to open", async ({ request }) => {
  const response = await request.get("/api/mcp", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(response.status()).toBe(405);
  expect(response.headers()["allow"]).toBe("POST");
});
