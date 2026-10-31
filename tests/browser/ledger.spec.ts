import { test, expect } from "@playwright/test";
import { dispatchRest } from "../../src/lib/rest";
import { database, databaseStore } from "../support";

test.use({ hasTouch: true });

test("create a group, split dinner, record repayment, and correct an expense in the browser", async ({ page }) => {
  const db = await database();
  const store = databaseStore(db);
  // Google is external. This fixture supplies a signed-in session and exercises
  // the UI against the real ledger functions and Postgres migration locally.
  await page.route("**/api/session", route => route.fulfill({ json: { data: { configured: true, user: { id: "11111111-1111-4111-8111-111111111111", email: "hobby@example.com" } } } }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split("/").slice(3);
    const response = await dispatchRest(new Request(request.url(), { method: request.method(), headers: { "Content-Type": "application/json" }, body: request.postData() || undefined }), store, parts);
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await page.getByRole("button", { name: "Create your first group" }).click();
    await page.getByLabel("Group name").fill("Weekend away");
    await page.getByLabel("People, separated by commas").fill("Me, Sam, Alex");
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Weekend away" })).toBeVisible();
    await page.getByRole("button", { name: "+ Add expense" }).click();
    await page.getByLabel("Description", { exact: true }).fill("Dinner");
    await page.getByLabel("Amount (CAD)", { exact: true }).fill("90");
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.getByRole("heading", { name: "Dinner", exact: true })).toBeVisible();
    await page.getByText("Balances & repayments", { exact: true }).click();
    await expect(page.locator(".balance-row").filter({ hasText: "Sam" })).toContainText("$30.00");
    await page.getByRole("button", { name: "More group actions", exact: true }).click();
    await page.getByRole("button", { name: "Record repayment", exact: true }).click();
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Sam" });
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Owner" });
    await page.getByLabel("Amount (CAD)", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Record repayment", exact: true }).last().click();
    await expect(page.locator(".balance-row").filter({ hasText: "Sam" })).toContainText("all square");
    await page.getByRole("button", { name: "Edit Dinner", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Dinner together");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Dinner together", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 768, height: 1024 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/splitzii-ledger-tablet.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "/tmp/splitzii-ledger-desktop.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "/tmp/splitzii-ledger-mobile.png", fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Edit Dinner together", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveCSS("font-size", "16px");
    await page.getByRole("button", { name: "Close form", exact: true }).click();
    await page.getByRole("button", { name: "Delete Dinner together", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Start with the first expense." })).toBeVisible();
    await page.getByRole("button", { name: "More group actions", exact: true }).click();
    await page.getByRole("button", { name: "+ New group", exact: true }).click();
    const longName = "Summer holiday with friends — mountains, beaches, and a weekend together";
    await page.getByLabel("Group name").fill(longName);
    await page.getByLabel("People, separated by commas").fill("Me, Sam, Alex");
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page.getByRole("heading", { name: longName, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await db.close(); }
});

test("welcome and agent connection fit a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/api/session", route => route.fulfill({ json: { data: { configured: true, user: null } } }));
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await expect(page.getByRole("link", { name: /Continue with Google/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/splitzii-welcome-mobile.png", fullPage: true, animations: "disabled" });
  await page.route("**/api/session", route => route.fulfill({ json: { data: { configured: true, user: { id: "11111111-1111-4111-8111-111111111111", email: "hobby@example.com" } } } }));
  await page.route("**/api/v1/groups", route => route.fulfill({ json: { data: [] } }));
  await page.reload();
  await page.getByRole("button", { name: "Agent connection", exact: true }).click();
  await expect(page.getByLabel("MCP endpoint")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/splitzii-agent-mobile.png", fullPage: true, animations: "disabled" });
});
