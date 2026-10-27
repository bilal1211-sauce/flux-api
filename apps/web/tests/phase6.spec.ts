import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { e2eApiOrigin, readDemoAccount } from "./e2e-helpers";

const demo = readDemoAccount();

async function signIn(page: Page) {
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(demo.email);
  await page.getByLabel("Password", { exact: true }).fill(demo.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("apiforge-theme", value);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function waitForHistory(page: Page) {
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".history-table tbody tr").first().or(page.getByText("No runs match these filters"))).toBeVisible();
}

async function waitForIncidents(page: Page) {
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".incident-table tbody tr").first().or(page.getByText("No incidents match these filters"))).toBeVisible();
}

test("Run History filters, paginates, compares, exports, and opens a saved Studio request", async ({ page, request }) => {
  const preview = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(preview, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);

  const login = await request.post(`${e2eApiOrigin}/api/v1/auth/login`, {
    data: { email: demo.email, password: demo.password },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.token as string;
  const authHeaders = { Authorization: `Bearer ${token}` };
  const workspaceResponse = await request.get(`${e2eApiOrigin}/api/v1/workspaces`, { headers: authHeaders });
  expect(workspaceResponse.status()).toBe(200);
  const workspace = (await workspaceResponse.json()).data[0] as { id: number };
  const [requestsResponse, environmentsResponse] = await Promise.all([
    request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/requests?per_page=100`, { headers: authHeaders }),
    request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/environments?per_page=100`, { headers: authHeaders }),
  ]);
  expect(requestsResponse.status()).toBe(200);
  expect(environmentsResponse.status()).toBe(200);
  const savedRequest = (await requestsResponse.json()).data.find((item: { name: string }) => item.name === "List posts") as { id: number };
  const environment = (await environmentsResponse.json()).data.find((item: { name: string }) => item.name === "Demo") as { id: number };
  expect(savedRequest).toBeTruthy();
  expect(environment).toBeTruthy();
  const monitorResponse = await request.post(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/monitors`, {
    headers: authHeaders,
    data: {
      name: "Phase 6 history fixture",
      api_request_id: savedRequest.id,
      environment_id: environment.id,
      interval_minutes: 5,
      enabled: true,
      failure_threshold: 2,
    },
  });
  expect(monitorResponse.status()).toBe(201);
  const monitor = (await monitorResponse.json()).data as { id: number };
  const checkResponse = await request.post(`${e2eApiOrigin}/api/v1/workspaces/${workspace.id}/monitors/${monitor.id}/check`, { headers: authHeaders });
  expect(checkResponse.status()).toBe(200);
  expect(["passed", "failed"]).toContain((await checkResponse.json()).data.outcome);

  await page.goto("/history");
  await waitForHistory(page);

  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase6-after-history-dark.png"), fullPage: true });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase6-after-history-light.png"), fullPage: true });
  await setTheme(page, "dark");

  const rows = page.locator(".history-table tbody tr");
  const rowCount = await rows.count();
  if (rowCount >= 2) {
    await page.getByLabel(/^Select run .* for comparison$/).nth(0).check();
    await page.getByLabel(/^Select run .* for comparison$/).nth(1).check();
    await page.getByRole("button", { name: "Compare selected (2/2)" }).click();
    await expect(page.getByRole("dialog", { name: "Compare selected runs" })).toBeVisible();
    await expect(page.getByText(/Duration/).last()).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
  }

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Filter by source").selectOption("monitor");
  await expect(page.locator(".history-table tbody")).toContainText("monitor");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await waitForHistory(page);

  const next = page.getByRole("button", { name: "Next", exact: true });
  if ((await next.count()) > 0 && await next.isEnabled()) {
    await next.click();
    await expect(page.locator(".history-pagination")).toContainText("Page 2");
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered runs" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("fluxapi-run-history.json");

  await page.goto("/history");
  await waitForHistory(page);
  const firstRunRow = page.locator(".history-table tbody tr").first();
  const inspect = firstRunRow.getByRole("button", { name: /^Inspect run/ });
  if (await inspect.isVisible()) {
    await inspect.click();
    const detail = page.getByRole("dialog").last();
    await expect(detail.getByText("Stored execution record")).toBeVisible();
    const studioLink = detail.getByRole("link", { name: /Open in Studio/ });
    if (await studioLink.isVisible()) {
      await studioLink.click();
      await expect(page).toHaveURL(/\/studio\?request=\d+/);
      await expect(page.getByRole("heading", { name: "Request Studio" })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Close dialog" }).click();
    }
  }

  await page.goto("/history");
  await waitForHistory(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase6-after-history-390-dark.png") });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase6-after-history-390.png") });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("region", { name: "Run history filters" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close filters" }).last().click();

  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `History has horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test("Incident Center separates acknowledgment from recovery and follows monitor/run links", async ({ page }) => {
  const preview = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(preview, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.goto("/alerts");
  await waitForIncidents(page);

  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase6-after-alerts-dark.png"), fullPage: true });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase6-after-alerts-light.png"), fullPage: true });

  const first = page.locator(".incident-table tbody tr").first();
  if (await first.isVisible()) {
    await first.getByRole("button", { name: "Details" }).click();
    const detail = page.getByRole("dialog", { name: /Incident #\d+/ });
    await expect(detail.getByRole("heading", { name: "Incident timeline" })).toBeVisible();
    await expect(detail.getByRole("link", { name: "Related run history" })).toBeVisible();
    const openMonitor = detail.getByRole("link", { name: "Open monitor" });
    await expect(openMonitor).toBeVisible();
    await openMonitor.click();
    await expect(page).toHaveURL(/\/monitoring\?monitor=\d+/);
    await expect(page.getByRole("dialog")).toContainText("monitor details");
    const incidentLink = page.getByRole("link", { name: /reached .* failures/i }).first();
    if (await incidentLink.isVisible()) {
      await incidentLink.click();
      await expect(page).toHaveURL(/\/alerts\?incident=\d+/);
      await expect(page.getByRole("dialog", { name: /Incident #/ })).toBeVisible();
    }
  }

  await page.goto("/alerts");
  await waitForIncidents(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Filter by incident status").selectOption("resolved");
  if (await page.locator(".incident-table tbody tr").count()) {
    await expect(page.locator(".incident-table tbody")).not.toContainText("Open");
  }
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase6-after-alerts-390-dark.png") });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase6-after-alerts-390.png") });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("region", { name: "Incident filters" })).toBeVisible();
  await page.getByRole("button", { name: "Close incident filters" }).last().click();

  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `Alerts has horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});
