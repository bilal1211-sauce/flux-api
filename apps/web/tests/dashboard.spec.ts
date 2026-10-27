import { expect, test, type Page } from "@playwright/test";
import { readDemoAccount } from "./e2e-helpers";
import type { Run, Summary } from "../src/lib/types";

const run: Run = {
  id: 741,
  name: "Lookup order",
  method: "GET",
  url: "https://api.example.test/v1/orders?token=not-shown",
  outcome: "failed",
  status: 422,
  duration_ms: 214,
  size_bytes: 74,
  error_code: "HTTP_ERROR",
  source: "manual",
  execution_mode: "cloud",
  execution_id: null,
  timings: { dns_ms: 8, connect_ms: 13, tls_ms: 18, first_byte_ms: 173 },
  created_at: "2026-10-19T09:30:00.000Z",
  response: {
    headers: { "content-type": "application/json" },
    body: '{"error":"invalid order"}',
    truncated: false,
  },
  assertions: [{ type: "status", expected: 200, actual: 422, passed: false }],
};

const summary: Summary = {
  period: "Last 7 days",
  period_days: 7,
  total_runs: 5,
  passed_runs: 4,
  failed_runs: 1,
  success_rate: 80,
  avg_latency_ms: 124,
  p95_latency_ms: 228,
  monitor_availability: 96,
  monitor_checks: 25,
  daily: [
    { day: "2026-10-17", runs: 2, passed: 2, avg_ms: 112, p95_ms: 154 },
    { day: "2026-10-18", runs: 1, passed: 1, avg_ms: 132, p95_ms: 132 },
    { day: "2026-10-19", runs: 2, passed: 1, avg_ms: 128, p95_ms: 214 },
  ],
  daily_assertions: [
    { day: "2026-10-17", passed: 2, failed: 0 },
    { day: "2026-10-18", passed: 1, failed: 1 },
    { day: "2026-10-19", passed: 3, failed: 3 },
  ],
  collections: 3,
  requests: 12,
  active_monitors: 1,
  monitor_snapshots: [
    {
      id: 44,
      name: "Orders API",
      last_outcome: "passed",
      last_run_at: "2026-10-19T09:00:00.000Z",
      consecutive_failures: 0,
      last_status: 200,
      last_duration_ms: 122,
      error_code: null,
      open_incidents: 0,
    },
  ],
  open_alerts: 0,
  recent_runs: [run],
  failure_classes: [{ category: "HTTP_ERROR", total: 1 }],
  usage_today: 5,
  daily_limit: 1000,
  cloud_runs: 3,
  local_runs: 2,
  assertions_passed: 6,
  assertions_failed: 4,
  endpoint_performance: [
    { name: "Lookup order", method: "GET", runs: 5, avg_ms: 124, passed: 4 },
  ],
  status_classes: [
    { category: "2xx", total: 4 },
    { category: "4xx", total: 1 },
  ],
};

async function signIn(page: Page) {
  const account = readDemoAccount();
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page.locator('.sidebar .nav-link[aria-current="page"]'),
  ).toContainText("Overview");
}

async function mockSummary(
  page: Page,
  respond: (
    days: string | null,
  ) => Promise<{ status?: number; data: Summary | { message: string } }>,
) {
  await page.route("**/api/gateway/workspaces/*/summary**", async (route) => {
    const response = await respond(
      new URL(route.request().url()).searchParams.get("days"),
    );
    await route.fulfill({
      status: response.status ?? 200,
      json:
        response.status && response.status >= 400
          ? response.data
          : { data: response.data },
    });
  });
}

test("dashboard metrics use distinct real metric definitions, filter periods, chart and open run details", async ({
  page,
}) => {
  const periods: string[] = [];
  await mockSummary(page, async (days) => {
    if (days) periods.push(days);
    return {
      data: {
        ...summary,
        period_days: Number(days || 7),
        period: days === "1" ? "Last 1 day" : `Last ${days || 7} days`,
      },
    };
  });
  await page.addInitScript(() =>
    localStorage.setItem("apiforge-theme", "dark"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);

  await expect(
    page.getByRole("link", { name: /Saved requests/ }),
  ).toContainText("12");
  await expect(
    page.getByRole("link", { name: /Runs in selected period/ }),
  ).toContainText("5");
  await expect(
    page.getByRole("link", { name: /Assertion pass rate/ }),
  ).toContainText("60%");
  await expect(
    page.getByRole("link", { name: /Average response time/ }),
  ).toContainText("124");
  await expect(
    page.getByRole("link", { name: /Active monitors/ }),
  ).toContainText("1");
  await expect(
    page.getByRole("link", { name: /Open incidents/ }),
  ).toContainText("0");
  await expect(
    page.getByRole("img", { name: "Average response time by day" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "P95", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "P95 response time by day" }),
  ).toBeVisible();
  await page.locator(".dashboard-chart-hit-target").last().hover();
  await expect(
    page.getByRole("status").filter({ hasText: "214 ms P95" }),
  ).toBeVisible();

  await page.getByLabel("Dashboard time range").selectOption("1");
  await expect.poll(() => periods).toContain("1");
  await page.getByLabel("Dashboard time range").selectOption("30");
  await expect.poll(() => periods).toContain("30");
  await expect(
    page.locator(".dashboard-response-panel .panel-heading p"),
  ).toContainText("Last 30 days");
  await expect(
    page.getByRole("link", { name: /1 failed execution in last 30 days/ }),
  ).toHaveAttribute("href", "/history?outcome=failed");

  const execution = page.getByRole("link", {
    name: /Open details for Lookup order/,
  });
  await expect(execution).toHaveAttribute("href", "/history?run=741");
  expect(
    await page.locator(".dashboard-execution-name").innerText(),
  ).not.toContain("token=not-shown");
  await page.route("**/api/gateway/workspaces/*/runs**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/runs/741")) {
      await route.fulfill({ json: { data: run } });
    } else {
      await route.fulfill({
        json: {
          data: { data: [run], current_page: 1, last_page: 1, total: 1 },
        },
      });
    }
  });
  await execution.click();
  await expect(page).toHaveURL(/\/history\?run=741$/);
  await expect(page.getByRole("dialog", { name: "Run #741" })).toBeVisible();
  await expect(page.getByText("invalid order")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/dashboard");
  await page
    .getByRole("link", { name: /1 failed execution in last 7 days/ })
    .click();
  await expect(page).toHaveURL(/\/history\?outcome=failed$/);
  await expect(page.getByLabel("Filter by result")).toHaveValue("failed");

  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".dashboard-kpis")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `dashboard overflow at ${width}px`,
    ).toBe(true);
  }
});

test("dashboard presents truthful empty and healthy states", async ({
  page,
}) => {
  const empty: Summary = {
    ...summary,
    total_runs: 0,
    passed_runs: 0,
    failed_runs: 0,
    success_rate: null,
    avg_latency_ms: null,
    p95_latency_ms: null,
    monitor_availability: null,
    monitor_checks: 0,
    daily: [],
    daily_assertions: [],
    active_monitors: 0,
    monitor_snapshots: [],
    open_alerts: 0,
    recent_runs: [],
    cloud_runs: 0,
    local_runs: 0,
    assertions_passed: 0,
    assertions_failed: 0,
    status_classes: [],
  };
  await mockSummary(page, async () => ({ data: empty }));
  await signIn(page);
  await expect(page.getByText("No response data in this period")).toBeVisible();
  await expect(page.getByText("No assertions in this period")).toBeVisible();
  await expect(page.getByText("No executions yet")).toBeVisible();
  await expect(page.getByText("No active monitors")).toBeVisible();
  await expect(page.getByText("All clear")).toBeVisible();
});

test("dashboard gives an actionable summary error and retries successfully", async ({
  page,
}) => {
  let attempts = 0;
  await mockSummary(page, async () => {
    attempts += 1;
    return attempts === 1
      ? { status: 503, data: { message: "Summary service unavailable" } }
      : { data: summary };
  });
  await signIn(page);
  await expect(page.locator(".dashboard-load-error")).toContainText(
    "Dashboard data could not be loaded",
  );
  await expect(page.getByText("Summary service unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Response performance" }),
  ).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});
