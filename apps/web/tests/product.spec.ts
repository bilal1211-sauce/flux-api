import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { e2eApiOrigin } from "./e2e-helpers";

const email = `e2e-${Date.now()}@example.test`;
const password = "ApiForgeTest2026!";
let workspaceId: number;
let token: string;

test.beforeAll(async ({ request }) => {
  const response = await request.post(
    `${e2eApiOrigin}/api/v1/auth/register`,
    {
      data: {
        name: "Test engineer",
        email,
        password,
        password_confirmation: password,
      },
    },
  );
  expect(response.status()).toBe(201);
  token = (await response.json()).data.token;
  const workspaces = await request.get(
    `${e2eApiOrigin}/api/v1/workspaces`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  workspaceId = (await workspaces.json()).data[0].id;
});

test("complete workspace flow persists requests and records execution outcomes", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  const session = (await page.context().cookies()).find(
    (c) => c.name === "apiforge_session",
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await page.getByRole("button", { name: "Create collection" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Payments API");
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(
    page.getByRole("button", { name: /^Payments API/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Payments API/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "API Studio", exact: false })
    .first()
    .click();
  await page
    .getByLabel("Request name", { exact: true })
    .fill("Portfolio smoke request");
  await page.getByLabel("Request URL", { exact: true }).fill("https://jsonplaceholder.typicode.com/posts/1");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Request saved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Send/ }).click();
  const successfulResponse = page.getByText("200 OK", { exact: true });
  const networkError = page.getByText("NETWORK ERROR", { exact: true });
  await expect(successfulResponse.or(networkError)).toBeVisible({ timeout: 30000 });
  const requestSucceeded = await successfulResponse.isVisible();
  await page
    .getByRole("button", { name: /^Assertions/ })
    .last()
    .click();
  await expect(page.locator(".assertion-results")).toContainText(requestSucceeded ? "PASS" : "FAIL");
  await page.getByRole("link", { name: "Run History" }).click();
  await expect(
    page.getByText("Portfolio smoke request", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Inspect run/ })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByText(requestSucceeded ? "200 OK" : "Error Failed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Monitoring", exact: true }).click();
  await page.getByRole("button", { name: "Create monitor" }).click();
  await page.getByLabel("Monitor name").fill("Portfolio health");
  await page
    .getByLabel("Saved request")
    .selectOption({ label: "GET · Portfolio smoke request" });
  await page.getByRole("button", { name: "Save monitor" }).click();
  const monitorRow = page
    .locator(".monitor-table tbody tr")
    .filter({ hasText: "Portfolio health" });
  await expect(monitorRow).toBeVisible();
  await monitorRow
    .getByRole("button", { name: "Check Portfolio health now" })
    .click();
  const state = monitorRow.locator("td").nth(2);
  await expect(state.getByText(/^(Healthy|Degraded|Failing)$/)).toBeVisible({
    timeout: 30000,
  });
  await monitorRow
    .getByRole("button", { name: "Open Portfolio health details" })
    .click();
  const monitorDetails = page.getByRole("dialog");
  await expect(
    monitorDetails.getByRole("heading", { name: "Check history" }),
  ).toBeVisible();
  const latestCheck = monitorDetails.locator(".monitor-timeline li").first();
  await expect(latestCheck).toBeVisible();
  const latestCheckText = await latestCheck.innerText();
  const currentHealth = (await state.innerText()).trim();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const monitorList = await request.get(
    `${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/monitors?per_page=100`,
    { headers: authHeaders },
  );
  expect(monitorList.status()).toBe(200);
  const monitor = (await monitorList.json()).data.find(
    (item: { name: string }) => item.name === "Portfolio health",
  );
  expect(monitor).toBeTruthy();
  const monitorHistory = await request.get(
    `${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/monitors/${monitor.id}/history?per_page=1`,
    { headers: authHeaders },
  );
  expect(monitorHistory.status()).toBe(200);
  const latestRecordedCheck = (await monitorHistory.json()).data.history.data[0];
  expect(latestRecordedCheck).toBeTruthy();
  expect(monitor.last_outcome).toBe(latestRecordedCheck.outcome);
  expect(monitor.last_status).toBe(latestRecordedCheck.status);
  const expectedHealth = latestRecordedCheck.outcome === "passed"
    ? "Healthy"
    : latestRecordedCheck.status === null
      ? "Failing"
      : "Degraded";
  expect(currentHealth).toBe(expectedHealth);
  expect(latestCheckText).toContain(latestRecordedCheck.status === null
    ? latestRecordedCheck.error_code || "Execution failure"
    : String(latestRecordedCheck.status));
  await monitorDetails.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Create report" }).click();
  await page.getByLabel("Report name").fill("Portfolio report");
  await page.getByRole("button", { name: "Preview report" }).click();
  await page.getByRole("button", { name: "Create secure link" }).click();
  const reportUrl = await page.getByLabel("Report URL").inputValue();
  const report = await page.context().newPage();
  await report.goto(reportUrl);
  await expect(
    report.getByRole("heading", { name: "Portfolio report" }),
  ).toBeVisible();
  await report.close();
  await page.getByRole("link", { name: "Audit Trail", exact: true }).click();
  await expect(
    page.locator(".audit-table tbody").getByText("report.shared", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  const preview = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(preview, { recursive: true });
  await page.screenshot({
    path: resolve(preview, "dashboard-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: resolve(preview, "dashboard-light.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("mobile navigation, dark theme and layout fit a phone", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("link", { name: "API Studio", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Request Studio" }),
  ).toBeVisible();
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews"), "studio-mobile.png"),
    fullPage: true,
  });
});

test("gateway rejects cross-origin mutations and private destinations are blocked", async ({
  request,
}) => {
  const csrf = await request.post("/api/gateway/auth/login", {
    headers: { Origin: "https://evil.example" },
    data: { email, password },
  });
  expect(csrf.status()).toBe(403);
  const response = await request.post(
    `${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/execute`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: "SSRF check",
        method: "GET",
        url: "http://169.254.169.254/",
        headers: {},
        query_params: {},
        body: "",
        assertions: [],
      },
    },
  );
  expect(response.status()).toBe(422);
  const preview = resolve(dirname(process.env.E2E_DEMO_ACCOUNT_FILE || "."));
  writeFileSync(
    resolve(preview, "last-e2e.json"),
    JSON.stringify({
      email,
      workspaceId,
      completedAt: new Date().toISOString(),
    }),
  );
});
