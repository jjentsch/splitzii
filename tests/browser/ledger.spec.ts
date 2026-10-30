import { test, expect } from "@playwright/test";
import { dispatchRest } from "../../src/lib/rest";
import { database, databaseStore } from "../support";

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
    await page.goto("/");
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
    await expect(page.locator(".balance-row").filter({ hasText: "Sam" })).toContainText("$30.00");
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
    await page.screenshot({ path: "/tmp/splitzii-ledger-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/splitzii-ledger-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Delete Dinner together", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Start with the first expense." })).toBeVisible();
  } finally { await db.close(); }
});
