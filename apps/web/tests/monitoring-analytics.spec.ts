import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readDemoAccount } from "./e2e-helpers";

const demo = readDemoAccount();

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(demo.email);
  await page.getByLabel("Password", { exact: true }).fill(demo.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
}

async function setTheme(
  page: import("@playwright/test").Page,
  theme: "dark" | "light",
) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("apiforge-theme", value);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

const savedRequest = {
  id: 7,
  name: "Status endpoint",
  method: "GET",
  url: "https://api.example.test/v1/status?token={{token}}",
  collection_id: null,
  folder_id: null,
  headers: { Authorization: "Bearer {{token}}" },
  query_params: {},
  body: "",
  assertions: [{ type: "status", expected: 200 }],
};

const monitor = {
  id: 23,
  name: "API health monitor",
  api_request_id: 7,
  environment_id: null,
  interval_minutes: 5,
  enabled: true,
  next_run_at: null,
  last_run_at: "2026-10-26T10:00:00.000000Z",
  last_outcome: "failed",
  last_status: null,
  last_duration_ms: 44,
  last_error_code: "NETWORK_ERROR",
  consecutive_failures: 2,
  alert_rule: { failure_threshold: 2 },
  checks_7d: 2,
  passed_7d: 0,
  open_incidents: 1,
};

test("monitor actions retain failure health and show bounded, redacted detail history", async ({
  page,
}) => {
  const monitorWrites: { method: string; body: unknown }[] = [];
  await page.route("**/api/gateway/workspaces/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/requests") && request.method() === "GET") {
      await route.fulfill({
        json: {
          data: [savedRequest],
          meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 },
        },
      });
      return;
    }
    if (path.endsWith("/monitors") && request.method() === "GET") {
      await route.fulfill({
        json: {
          data: [monitor],
          meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
        },
      });
      return;
    }
    if (path.endsWith("/monitors/23/history")) {
      await route.fulfill({
        json: {
          data: {
            monitor: {
              ...monitor,
              environment_name: null,
              failure_threshold: 2,
              last_success_at: null,
              request: {
                id: 7,
                name: savedRequest.name,
                method: "GET",
                endpoint: "api.example.test/v1/status",
                assertions: [
                  { type: "status", path: null, expected_status: 200 },
                ],
              },
            },
            history: {
              data: [
                {
                  id: 51,
                  outcome: "failed",
                  status: null,
                  duration_ms: 44,
                  error_code: "NETWORK_ERROR",
                  execution_mode: "cloud",
                  created_at: "2026-10-26T10:00:00.000000Z",
                },
              ],
              current_page: 1,
              last_page: 1,
              per_page: 20,
              total: 1,
            },
            incidents: [
              {
                id: 9,
                monitor_id: 23,
                message: "Failure threshold reached",
                created_at: "2026-10-26T10:00:00.000000Z",
                resolved_at: null,
                acknowledged_at: null,
              },
            ],
          },
        },
      });
      return;
    }
    if (path.endsWith("/monitors/23/check")) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          message: "The approved destination policy rejected this endpoint.",
        }),
      });
      return;
    }
    if (
      /\/monitors(?:\/\d+)?$/.test(path) &&
      ["POST", "PUT", "DELETE"].includes(request.method())
    ) {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
      monitorWrites.push({ method: request.method(), body });
      await route.fulfill({
        status: request.method() === "POST" ? 201 : 200,
        json: { data: { ...monitor, ...((body as object) ?? {}) } },
      });
      return;
    }
    await route.continue();
  });

  await signIn(page);
  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
  await expect(
    page.locator(".monitor-table .badge").filter({ hasText: "Failing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create monitor" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create monitor" });
  await createDialog.getByLabel("Monitor name").fill("New uptime check");
  await createDialog.getByLabel("Saved request").selectOption("7");
  await createDialog.getByRole("button", { name: "Save monitor" }).click();
  await expect
    .poll(() =>
      monitorWrites.some(
        (write) =>
          write.method === "POST" &&
          (write.body as { name?: string }).name === "New uptime check",
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Edit API health monitor" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit monitor" });
  await editDialog.getByLabel("Monitor name").fill("Updated health monitor");
  await editDialog.getByRole("button", { name: "Save monitor" }).click();
  await expect
    .poll(() =>
      monitorWrites.some(
        (write) =>
          write.method === "PUT" &&
          (write.body as { name?: string }).name === "Updated health monitor",
      ),
    )
    .toBe(true);

  await page
    .getByRole("button", { name: "Check API health monitor now" })
    .click();
  await expect(
    page.getByText("The approved destination policy rejected this endpoint."),
  ).toBeVisible();
  await expect(
    page.locator(".monitor-table .badge").filter({ hasText: "Failing" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Open API health monitor details" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "API health monitor · monitor details",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Execution failure · NETWORK_ERROR"),
  ).toBeVisible();
  await expect(dialog.getByText("Last successful check")).toBeVisible();
  await expect(dialog.getByText("No HTTP response")).toBeVisible();
  await expect(dialog.getByText("Bearer {{token}}")).toHaveCount(0);
  await dialog.getByRole("link", { name: /Run history/ }).click();
  await expect(page).toHaveURL(
    /\/history\?search=Status(?:%20|\+)endpoint&source=monitor/,
  );

  await page.goto("/monitoring");
  await page.getByRole("button", { name: "Pause API health monitor" }).click();
  await expect
    .poll(() =>
      monitorWrites.some(
        (write) =>
          write.method === "PUT" &&
          (write.body as { enabled?: boolean }).enabled === false,
      ),
    )
    .toBe(true);
  await page.goto("/monitoring");
  await page.getByRole("button", { name: "Delete API health monitor" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Delete API health monitor?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".monitor-mobile-card")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("analytics filters navigate to matching history and remain responsive in both themes", async ({
  page,
}) => {
  const previewDir = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(previewDir, { recursive: true });
  const summaryUrls: string[] = [];
  await page.route("**/api/gateway/workspaces/**/summary?**", async (route) => {
    summaryUrls.push(route.request().url());
    await route.continue();
  });
  await signIn(page);
  await page.goto("/analytics");
  await setTheme(page, "dark");
  await expect(
    page.getByRole("heading", { name: "API Analytics" }),
  ).toBeVisible();
  await page.getByLabel("Analytics period").selectOption("30");
  await page.getByLabel("Execution source").selectOption("monitor");
  await page.getByLabel("Execution mode").selectOption("local");
  await page.getByLabel("Filter by endpoint").fill("payments");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect
    .poll(() =>
      summaryUrls.some(
        (url) =>
          url.includes("days=30") &&
          url.includes("endpoint=payments") &&
          url.includes("source=monitor") &&
          url.includes("mode=local"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Execution performance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "HTTP response classes" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open filtered history" }).click();
  await expect(page).toHaveURL(
    /\/history\?search=payments&source=monitor&mode=local/,
  );
  await expect(
    page.getByRole("heading", { name: "Run history" }),
  ).toBeVisible();

  await page.goto("/analytics");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("heading", { name: "API Analytics" }),
  ).toBeVisible();
  await expect(page.locator(".analytics-performance-panel")).toBeVisible({
    timeout: 45000,
  });
  await expect(page.locator(".analytics-performance-panel")).toBeVisible({
    timeout: 45000,
  });
  await page.screenshot({
    path: resolve(previewDir, "phase5-analytics-dark.png"),
    fullPage: true,
  });
  await setTheme(page, "light");
  await page.screenshot({
    path: resolve(previewDir, "phase5-analytics-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(previewDir, "phase5-analytics-390.png"),
    fullPage: true,
  });
});

test("monitoring and analytics fit all required widths without horizontal page overflow", async ({
  page,
}) => {
  await signIn(page);
  for (const section of ["monitoring", "analytics"]) {
    await page.goto(`/${section}`);
    for (const width of [360, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".main-content h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${section} overflows at ${width}px`,
      ).toBe(true);
    }
  }
});

test("save monitoring theme screenshots at desktop and 390px", async ({
  page,
}) => {
  const previewDir = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(previewDir, { recursive: true });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/monitoring");
  await setTheme(page, "dark");
  await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "API connection: online" }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "API connection: online" }),
  ).toBeVisible({ timeout: 45000 });
  await page.screenshot({
    path: resolve(previewDir, "phase5-monitoring-dark.png"),
    fullPage: true,
  });
  await setTheme(page, "light");
  await page.screenshot({
    path: resolve(previewDir, "phase5-monitoring-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(previewDir, "phase5-monitoring-390.png"),
    fullPage: true,
  });
});
