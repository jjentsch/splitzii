import { test, expect } from "@playwright/test";

test("the browser approves an agent connection and returns to the host", async ({ page }) => {
  const authorizationId = crypto.randomUUID();
  await page.route("**/api/oauth/authorization?*", route => route.fulfill({ json: { data: {
    authorization_id: authorizationId,
    redirect_uri: "http://localhost:3000/muse/callback",
    client: { id: crypto.randomUUID(), name: "Muse", uri: "https://agent.meta.ai", logo_uri: "" },
    user: { id: crypto.randomUUID(), email: "hobby@example.com" }, scope: "email",
  } } }));
  await page.route("**/api/oauth/authorization", async route => {
    expect(route.request().method()).toBe("POST");
    const form = new URLSearchParams(route.request().postData() || "");
    expect(form.get("authorization_id")).toBe(authorizationId);
    expect(form.get("action")).toBe("approve");
    await route.fulfill({ status: 303, headers: { Location: "http://localhost:3000/muse/callback?code=fixture&state=host-state" } });
  });
  await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await expect(page.getByText("Muse", { exact: true })).toBeVisible();
  await expect(page.getByText(/hobby@example.com/)).toBeVisible();
  await page.screenshot({ path: "/tmp/splitzii-oauth-consent.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3000/muse/callback?code=fixture&state=host-state");
});
