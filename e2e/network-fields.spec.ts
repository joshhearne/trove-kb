import { expect, test } from "@playwright/test";
import { createCompany, createDocType, createDocument, signInAsAdmin, unique } from "./support";
import { psql } from "./db";

/**
 * Network field types: an IP address is one host unless a prefix says which
 * subnet it sits on, a network is a block snapped to its boundary, and a MAC
 * address takes its format the moment it is pasted.
 */

const DOC_TYPE = unique("E2E Network");
const COMPANY = unique("E2E Net Co");
const TITLE = unique("Head office LAN");

let docTypeId: string;
let editUrl: string;
let viewUrl: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  docTypeId = await createDocType(page, DOC_TYPE, [
    { label: "Mgmt IP", type: "ip" },
    { label: "LAN", type: "network" },
    { label: "DHCP Pool", type: "ip_range" },
    { label: "VLAN", type: "vlan" },
    { label: "Host", type: "hostname" },
  ]);

  // A MAC field with a format of its own, chosen as it is created.
  await page.getByLabel("Label").fill("Port MAC");
  await page.getByLabel("Type").selectOption("mac");
  await expect(page.getByText("rewritten in this format straight away")).toBeVisible();
  await page.getByLabel("MAC address format").selectOption("colon_lower");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Port MAC" })).toContainText(
    "78:45:58:8a:dc:95",
  );

  const companyId = await createCompany(page, COMPANY);
  const documentId = await createDocument(page, companyId, DOC_TYPE, TITLE);
  viewUrl = `/documents/${documentId}`;
  editUrl = `${viewUrl}/edit`;
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("explains the prefix selector when an IP address field is created", async ({ page }) => {
  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("Type").selectOption("ip");
  await expect(page.getByText("comes with a prefix (/nn) selector")).toBeVisible();
  await page.getByLabel("Type").selectOption("network");
  await expect(page.getByText("Holds a whole network, not one address")).toBeVisible();
});

test("formats a pasted MAC address at once", async ({ page }) => {
  await page.goto(editUrl);
  const mac = page.getByRole("textbox", { name: "Port MAC", exact: true });
  await mac.fill("78-45-58-8A-DC-95");
  await expect(mac).toHaveValue("78:45:58:8a:dc:95");
});

test("splits an address and mask typed together", async ({ page }) => {
  await page.goto(editUrl);
  const address = page.getByRole("textbox", { name: "Mgmt IP address" });
  await address.fill("10.0.0.5 255.255.255.0");
  await address.blur();
  await expect(address).toHaveValue("10.0.0.5");
  await expect(page.getByRole("combobox", { name: "Mgmt IP prefix" })).toHaveValue("24");
  await expect(page.getByText("On 10.0.0.0/24: usable 10.0.0.1 to 10.0.0.254 (254).")).toBeVisible();
});

test("refuses a network of a single address", async ({ page }) => {
  await page.goto(editUrl);
  await page.getByRole("textbox", { name: "LAN address" }).fill("192.168.1.5/32");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByText("A /32 is a single address")).toBeVisible();
});

test("saves each network type and tells an address from a network", async ({ page }) => {
  await page.goto(editUrl);

  // A blank prefix is one address.
  await page.getByRole("textbox", { name: "Mgmt IP address" }).fill("192.168.1.10");
  await expect(page.getByText("One address (/32).")).toBeVisible();

  await page.getByRole("textbox", { name: "LAN address" }).fill("192.168.1.77");
  await page.getByRole("combobox", { name: "LAN prefix" }).selectOption("24");
  await expect(page.getByText("Saved as 192.168.1.0/24.")).toBeVisible();

  await page.getByRole("textbox", { name: "DHCP Pool, first address" }).fill("192.168.1.100");
  await page.getByRole("textbox", { name: "DHCP Pool, last address" }).fill("192.168.1.199");
  await expect(page.getByText("100 addresses.")).toBeVisible();

  await page.getByRole("spinbutton", { name: "VLAN", exact: true }).fill("20");
  await page.getByRole("textbox", { name: "Host", exact: true }).fill("FW01.Example.com");
  await page.getByRole("textbox", { name: "Port MAC", exact: true }).fill("7845588ADC95");

  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(viewUrl);

  const row = (label: string) =>
    page.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) });

  await expect(row("Mgmt IP")).toContainText("Address");
  await expect(row("Mgmt IP")).toContainText("192.168.1.10");
  await expect(row("Mgmt IP")).not.toContainText("/32");

  await expect(row("LAN")).toContainText("Network");
  await expect(row("LAN")).toContainText("192.168.1.0/24");
  await row("LAN").getByText("Block details").click();
  await expect(row("LAN")).toContainText("192.168.1.255");
  await expect(row("LAN")).toContainText("254");

  await expect(row("DHCP Pool")).toContainText("192.168.1.100 – 192.168.1.199");
  await expect(row("VLAN")).toContainText("20");
  await expect(row("Host")).toContainText("fw01.example.com");
  await expect(row("Port MAC")).toContainText("78:45:58:8a:dc:95");
});

test("finds a document by a MAC address however it is spelled", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("78-45-58-8a-dc-95")}`);
  await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
});

test("the instance MAC format applies to fields without their own", async ({ page }) => {
  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("Label").fill("NIC MAC");
  await page.getByLabel("Type").selectOption("mac");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "NIC MAC" })).toContainText(
    "78:45:58:8A:DC:95",
  );

  await page.goto("/admin/settings");
  await page.getByLabel("MAC address format").selectOption("hyphen_lower");
  await page.getByRole("button", { name: "Update network fields" }).click();
  await expect
    .poll(() => psql("select mac_format from instance_settings;"))
    .toBe("hyphen_lower");

  await page.goto(editUrl);
  const nic = page.getByRole("textbox", { name: "NIC MAC", exact: true });
  await nic.fill("78:45:58:8A:DC:95");
  await expect(nic).toHaveValue("78-45-58-8a-dc-95");
  // The field with a format of its own keeps it.
  await expect(page.getByRole("textbox", { name: "Port MAC", exact: true })).toHaveValue(
    "78:45:58:8a:dc:95",
  );

  // Put it back, since every other spec reads this instance.
  await page.goto("/admin/settings");
  await page.getByLabel("MAC address format").selectOption("colon_upper");
  await page.getByRole("button", { name: "Update network fields" }).click();
  await expect.poll(() => psql("select mac_format from instance_settings;")).toBe("colon_upper");
});
