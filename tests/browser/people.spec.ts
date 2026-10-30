import { test, expect } from "@playwright/test";
import { dispatchRest } from "../../src/lib/rest";
import { database, databaseStore } from "../support";

test("save a friend, add them to an expense by name, add a registered person, and view activity", async ({ page }) => {
  const db = await database();
  const store = databaseStore(db);
  await page.route("**/api/session", route => route.fulfill({ json: { data: { configured: true, user: { id: "11111111-1111-4111-8111-111111111111", email: "hobby@example.com" } } } }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const response = await dispatchRest(new Request(request.url(), { method: request.method(), headers: { "Content-Type": "application/json" }, body: request.postData() || undefined }), store, new URL(request.url()).pathname.split("/").slice(3));
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Friends", exact: true }).click();
    await page.getByLabel("Friend name or email", { exact: true }).fill("me");
    await expect(page.getByRole("status")).toContainText("No matching users");
    await expect(page.getByRole("button", { name: "Save friend", exact: true })).toBeDisabled();
    await page.getByLabel("Friend name or email", { exact: true }).fill("jamie@example.com");
    await page.getByRole("button", { name: /Jamie.*jamie@example.com/ }).click();
    await page.getByRole("button", { name: "Save friend", exact: true }).click();
    await expect(page.getByText("jamie@example.com", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Your ledger", exact: true }).click();
    await page.getByRole("button", { name: "Create your first group" }).click();
    await page.getByLabel("Group name", { exact: true }).fill("Friday dinner");
    await page.getByLabel("People, separated by commas", { exact: true }).fill("Me, Alex");
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Friday dinner", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "+ Add expense", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Dinner with Jamie");
    await page.getByLabel("Amount (CAD)", { exact: true }).fill("60");
    await page.getByLabel("Add someone to this expense (optional)", { exact: true }).fill("jamie");
    await page.getByRole("button", { name: /jamie.*jamie@example.com/i }).click();
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dinner with Jamie", exact: true })).toBeVisible();
    await expect(page.locator(".balance-row").filter({ hasText: "Jamie" })).toContainText("$20.00");
    await page.getByRole("button", { name: "Add a person", exact: true }).click();
    await page.getByLabel("Person name or email", { exact: true }).fill("jo@example.com");
    await page.getByRole("button", { name: /Jo.*jo@example.com/ }).click();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.locator(".balance-row").filter({ hasText: "Jo" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Dinner with Jamie", exact: true }).click();
    await page.getByRole("button", { name: "Restore Dinner with Jamie", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dinner with Jamie", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByText("expense restored · Dinner with Jamie", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/splitzii-people-activity-mobile.png", fullPage: true });
  } finally { await db.close(); }
});
