import { test, expect, type Page } from "@playwright/test";
import { execute, type GroupSummary } from "../../src/lib/ledger";
import { dispatchRest } from "../../src/lib/rest";
import { database, databaseStore } from "../support";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function checkTouchLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const smallTargets = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".app-shell button, .app-shell a[href], .app-shell input:not([type=hidden]), .app-shell select, .app-shell summary")].flatMap(element => {
    const target = element.matches("input[type=checkbox]") ? element.closest("label")! : element;
    const box = target.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(target).visibility === "hidden") return [];
    return box.width < 43.9 || box.height < 43.9 ? [`${element.getAttribute("aria-label") || element.textContent || element.tagName}: ${box.width} × ${box.height}`] : [];
  }));
  expect(smallTargets).toEqual([]);
  for (const field of await page.locator("input:not([type=hidden]):not([type=checkbox]), select, textarea").all()) {
    if (await field.isVisible()) await expect(field).toHaveCSS("font-size", "16px");
  }
}

async function checkSheet(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transform", "none");
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(page.viewportSize()!.width);
  expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height);
  await expect(dialog.getByRole("button", { name: /Close/ })).toBeFocused();
  await checkTouchLayout(page);
}

test("native mobile tabs, sheets, scrolling, and touch layouts", async ({ page }) => {
  const db = await database();
  const store = databaseStore(db);
  const group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "Weekend away", participant_names: ["Me", "Sam", "Alex"] }) as GroupSummary;
  for (let index = 0; index < 10; index++) await execute(store, "add_expense", { request_id: crypto.randomUUID(), group_id: group.id, description: `Shared dinner ${index + 1}`, amount_minor: 9000, paid_by_participant_id: group.participants[0].id, split_between_participant_ids: group.participants.map(person => person.id), date: "2026-10-30" });
  await page.route("**/api/session", route => route.fulfill({ json: { data: { configured: true, user: { id: "11111111-1111-4111-8111-111111111111", email: "hobby@example.com" } } } }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const response = await dispatchRest(new Request(request.url(), { method: request.method(), headers: { "Content-Type": "application/json" }, body: request.postData() || undefined }), store, new URL(request.url()).pathname.split("/").slice(3));
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  try {
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect(page.locator(".group-list-row")).toBeVisible();
    await checkTouchLayout(page);
    await page.screenshot({ path: "/tmp/splitzii-native-home.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Open account" }).click();
    await checkSheet(page);
    await expect(page.getByRole("dialog")).toContainText("hobby@example.com");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open account" })).toBeFocused();

    const tabs = page.getByRole("navigation", { name: "Main navigation" });
    for (const [label, heading] of [["Friends", "Your friends."], ["Activity", "Group activity."], ["Agent connection", "Meet your agent."]] as const) {
      await tabs.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(tabs.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
      await checkTouchLayout(page);
    }
    await tabs.getByRole("button", { name: "Search", exact: true }).click();
    await checkSheet(page);
    await page.getByLabel("Search your groups").fill("Weekend");
    await page.getByRole("dialog").getByRole("button", { name: /Weekend away/ }).click();
    await expect(page.getByRole("heading", { name: "Weekend away", exact: true })).toBeVisible();
    await checkTouchLayout(page);
    await page.screenshot({ path: "/tmp/splitzii-native-detail-light.png", fullPage: false, animations: "disabled" });

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(tabs).toHaveAttribute("data-compact", "true");
    await expect(page.locator(".mobile-topbar")).toHaveAttribute("data-title-visible", "true");
    await expect(tabs.getByRole("button", { name: "Your ledger", exact: true })).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(tabs).toHaveAttribute("data-compact", "false");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(tabs).toHaveAttribute("data-compact", "false");
    await page.getByRole("button", { name: "Back to ledger", exact: true }).click();
    await expect(page.locator(".group-list-row")).toBeVisible();
    await page.locator(".group-list-row").click();
    await page.getByRole("button", { name: "+ Add expense", exact: true }).click();
    await checkSheet(page);
    await page.screenshot({ path: "/tmp/splitzii-native-form.png", fullPage: false, animations: "disabled" });
    await page.getByRole("button", { name: "Close form" }).click();
    await expect(page.getByRole("button", { name: "+ Add expense", exact: true })).toBeFocused();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkTouchLayout(page);
    await expect(page.locator(".page-description")).toHaveCSS("color", "rgb(197, 200, 208)");
    await expect(page.locator(".section-heading .primary")).toHaveCSS("background-color", "rgb(241, 242, 244)");
    await page.screenshot({ path: "/tmp/splitzii-native-detail-dark.png", fullPage: false, animations: "disabled" });

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByRole("button", { name: "Open account" })).toHaveCount(0);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await checkSheet(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to ledger", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Groups", exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/splitzii-native-tablet-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await checkTouchLayout(page);
    await page.screenshot({ path: "/tmp/splitzii-native-tablet.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(tabs).toHaveCount(0);
    await expect(page.locator(".sidebar")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/splitzii-native-desktop-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "/tmp/splitzii-native-desktop-dark.png", fullPage: true, animations: "disabled" });
  } finally { await db.close(); }
});
