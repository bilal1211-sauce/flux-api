import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { e2eApiOrigin, readDemoAccount } from "./e2e-helpers";

const previewDir = process.env.E2E_PREVIEW_DIR;

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("apiforge-theme", value);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function captureScreenshot(page: Page, filename: string) {
  if (!previewDir) throw new Error("The isolated test runner did not provide its screenshot path.");
  const toast = page.getByRole("button", { name: "Dismiss message" });
  if (await toast.isVisible()) await toast.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(4, 4);
  await page.waitForTimeout(180);
  await page.screenshot({ path: resolve(previewDir, filename), fullPage: true });
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `No horizontal overflow at ${width}px (document width minus viewport width)` }).toBeLessThanOrEqual(0);
}

test("Audit Trail and Admin Console stay secure, responsive, and fully actionable", async ({ page, request }) => {
  test.setTimeout(180000);
  if (!previewDir) throw new Error("The isolated E2E runner did not provide its screenshot destination.");
  mkdirSync(previewDir, { recursive: true });
  const account = readDemoAccount();
  const login = await request.post(`${e2eApiOrigin}/api/v1/auth/login`, { data: { email: account.email, password: account.password } });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).data.token as string;
  const auth = { Authorization: `Bearer ${token}` };
  const workspacesResponse = await request.get(`${e2eApiOrigin}/api/v1/workspaces`, { headers: auth });
  expect(workspacesResponse.ok()).toBeTruthy();
  const workspace = (await workspacesResponse.json()).data[0] as { id: number; name: string; daily_run_limit: number };
  const collectionName = `Phase 8 audit fixture ${Date.now()}`;
  const created = await request.post(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/collections`, { headers: auth, data: { name: collectionName, description: "Isolated audit UI fixture" } });
  expect(created.status()).toBe(201);
  const collectionId = (await created.json()).data.id as number;
  const auditResponse = await request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/audit?action=collections`, { headers: auth });
  expect(auditResponse.ok()).toBeTruthy();
  const auditPayload = await auditResponse.json();
  expect(auditPayload.data.total).toBe(1);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible();

  await page.getByRole("link", { name: "Audit Trail", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  await page.getByLabel("Search audit events").fill("collections.saved");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const auditRow = page.locator(".audit-table tbody tr").filter({ hasText: "collections.saved" });
  await expect(auditRow).toContainText("Saved collections");
  await expect(auditRow).toContainText(account.email);
  await auditRow.getByRole("button", { name: /^View audit event/ }).click();
  const eventDetail = page.getByRole("dialog", { name: /^Audit event/ });
  await expect(eventDetail).toContainText("collections.saved");
  await expect(eventDetail).toContainText(`Collection #${collectionId}`);
  await expect(eventDetail).toContainText(workspace.name);
  await expect(eventDetail).toContainText("No additional metadata was stored");
  await eventDetail.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Filter audit action category").selectOption("requests");
  await expect(page.getByText("No events match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search audit events").fill("collections.saved");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered events" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("fluxapi-audit-events.csv");
  const auditToast = page.getByRole("button", { name: "Dismiss message" });
  if (await auditToast.isVisible()) await auditToast.click();

  await setTheme(page, "dark");
  await captureScreenshot(page, "audit-trail-desktop-dark.png");
  await setTheme(page, "light");
  await captureScreenshot(page, "audit-trail-desktop-light.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const mobileAuditFilters = page.getByRole("dialog", { name: "Audit filters" });
  await expect(mobileAuditFilters).toBeVisible();
  await mobileAuditFilters.getByLabel("Filter audit action category").selectOption("collections");
  await mobileAuditFilters.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".audit-mobile-card").filter({ hasText: "collections.saved" })).toBeVisible();
  await setTheme(page, "dark");
  await captureScreenshot(page, "audit-trail-390-dark.png");
  await setTheme(page, "light");
  await captureScreenshot(page, "audit-trail-390-light.png");
  for (const width of [360, 390, 768, 1024, 1440, 1920]) await assertNoHorizontalOverflow(page, width);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Admin Console", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admin Console" })).toBeVisible();
  await expect(page.getByText("Not monitored", { exact: true })).toBeVisible();
  await page.getByLabel("Search workspaces").fill(workspace.name);
  const workspaceCard = page.locator(".admin-mobile-card, .admin-table-wrap tbody tr").filter({ hasText: workspace.name }).first();
  await expect(workspaceCard).toBeVisible();
  await page.getByRole("button", { name: "View", exact: true }).first().click();
  const workspaceDetail = page.getByRole("dialog", { name: "Workspace details" });
  await expect(workspaceDetail).toContainText(workspace.name);
  await expect(workspaceDetail).toContainText(account.email);
  await workspaceDetail.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Set quota", exact: true }).first().click();
  const quotaDialog = page.getByRole("dialog", { name: /^Workspace quota/ });
  await quotaDialog.getByLabel("Daily execution limit").fill(String(workspace.daily_run_limit + 1));
  await quotaDialog.getByRole("button", { name: "Review change" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm quota change" })).toContainText((workspace.daily_run_limit + 1).toLocaleString());
  await page.getByRole("button", { name: "Confirm quota update" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm quota change" })).toHaveCount(0);

  await page.getByLabel("Search user accounts").fill(account.email);
  const userRow = page.locator("#platform-users .admin-table-wrap tbody tr").filter({ hasText: account.email });
  await expect(userRow).toBeVisible();
  await userRow.locator("button").click({ timeout: 5000 });
  const userDetail = page.getByRole("dialog", { name: "Account details" });
  await expect(userDetail).toContainText(account.email);
  await expect(userDetail).toContainText("Platform administrator");
  await userDetail.getByRole("button", { name: "Close dialog" }).click();

  await setTheme(page, "dark");
  await captureScreenshot(page, "admin-console-desktop-dark.png");
  await setTheme(page, "light");
  await captureScreenshot(page, "admin-console-desktop-light.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await captureScreenshot(page, "admin-console-390-dark.png");
  await setTheme(page, "light");
  await captureScreenshot(page, "admin-console-390-light.png");
  for (const width of [360, 390, 768, 1024, 1440, 1920]) await assertNoHorizontalOverflow(page, width);

  const standardEmail = `phase8-standard-${Date.now()}@example.test`;
  const standard = await request.post(`${e2eApiOrigin}/api/v1/auth/register`, { data: { name: "Phase Eight Standard", email: standardEmail, password: "Phase8Standard2026!", password_confirmation: "Phase8Standard2026!" } });
  expect(standard.status()).toBe(201);
  const standardToken = (await standard.json()).data.token as string;
  const denied = await request.get(`${e2eApiOrigin}/api/v1/admin`, { headers: { Authorization: `Bearer ${standardToken}` } });
  expect(denied.status()).toBe(403);
});
