import { test, expect, type Page } from "@playwright/test";
import { readDemoAccount } from "./e2e-helpers";

async function openStudio(page: Page) {
  const demo = readDemoAccount();
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(demo.email);
  await page.getByLabel("Password", { exact: true }).fill(demo.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "API Studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Request Studio" })).toBeVisible();
}

function execution(status: number, body: string) {
  return {
    data: {
      id: 900001,
      name: "Studio phase 3 test",
      method: "GET",
      url: "https://api.example.test/resource",
      status,
      outcome: status >= 200 && status < 300 ? "passed" : "failed",
      duration_ms: 23,
      size_bytes: body.length,
      error_code: null,
      source: "manual",
      execution_mode: "cloud",
      created_at: new Date().toISOString(),
      assertions: [],
      response: { headers: { "content-type": "application/json" }, body, truncated: false },
    },
  };
}

test("HTTP failures remain inspectable as responses", async ({ page }) => {
  await openStudio(page);
  await page.route("**/api/gateway/workspaces/*/execute", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(execution(503, '{"message":"service unavailable"}')),
  }));
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator(".response-heading .badge").first()).toHaveText("503 Failed");
  await expect(page.locator(".response-content .cm-content")).toContainText("service unavailable");
});

test("the explorer fetches the next server page only when asked", async ({ page }) => {
  const requestPageCalls: number[] = [];
  const pageEnvelope = <T,>(data: T[], currentPage: number, lastPage = 1) => ({
    data,
    meta: { current_page: currentPage, last_page: lastPage, per_page: 100, total: lastPage > 1 ? 2 : data.length },
  });
  await page.route("**/api/gateway/workspaces/*/collections*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(pageEnvelope([{ id: 10, name: "Paged collection", description: "", sort_order: 0 }], 1)),
  }));
  await page.route("**/api/gateway/workspaces/*/folders*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(pageEnvelope([], 1)),
  }));
  await page.route("**/api/gateway/workspaces/*/requests*", (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page") || 1);
    requestPageCalls.push(pageNumber);
    const request = {
      id: pageNumber,
      name: pageNumber === 1 ? "First page request" : "Second page request",
      method: "GET",
      url: "https://api.example.test/resource",
      collection_id: 10,
      folder_id: null,
      headers: {},
      query_params: {},
      body: null,
      body_mode: "none",
      auth_type: "none",
      auth_config: {},
      timeout_ms: 15000,
      pinned: false,
      sort_order: pageNumber,
      assertions: [],
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageEnvelope([request], pageNumber, 2)) });
  });
  await openStudio(page);
  await expect(page.locator(".studio-tree-request").filter({ hasText: "First page request" })).toBeVisible();
  expect(requestPageCalls).toEqual([1]);
  await page.getByRole("button", { name: "Load more workspace items" }).click();
  await expect(page.locator(".studio-tree-request").filter({ hasText: "Second page request" })).toBeVisible();
  expect(requestPageCalls).toEqual([1, 2]);
  await expect(page.getByLabel("Open saved request")).toContainText("Second page request");
});

test("concurrent request tabs keep their own responses", async ({ page }) => {
  await openStudio(page);
  let releaseFirst: (() => void) | undefined;
  let signalFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolveStarted) => { signalFirstStarted = resolveStarted; });
  const firstResponse = new Promise<void>((resolveResponse) => { releaseFirst = resolveResponse; });
  let count = 0;
  await page.route("**/api/gateway/workspaces/*/execute", async (route) => {
    count += 1;
    if (count === 1) {
      signalFirstStarted?.();
      await firstResponse;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(execution(200, '{"result":"first tab"}')) }).catch(() => undefined);
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(execution(201, '{"result":"second tab"}')) });
  });

  await page.getByRole("button", { name: /^Send/ }).click();
  await firstStarted;
  await page.getByRole("button", { name: "New request tab" }).click();
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator(".response-content .cm-content")).toContainText("second tab");
  releaseFirst?.();
  await expect(page.locator(".response-content .cm-content")).toContainText("second tab");

  await page.locator(".request-tabs > div").first().getByRole("button").first().click();
  await expect(page.locator(".response-content .cm-content")).toContainText("first tab");
});

test("cloud request cancellation leaves no response attached", async ({ page }) => {
  await openStudio(page);
  let release: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>((resolveStarted) => { signalStarted = resolveStarted; });
  const waitForRelease = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  await page.route("**/api/gateway/workspaces/*/execute", async (route) => {
    signalStarted?.();
    await waitForRelease;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(execution(200, '{"result":"too late"}')) }).catch(() => undefined);
  });
  await page.getByRole("button", { name: /^Send/ }).click();
  await started;
  await page.getByRole("button", { name: "Stop waiting" }).click();
  await expect(page.locator(".response-heading .badge")).toHaveText("cancelled");
  release?.();
  await expect(page.locator(".response-content")).toHaveCount(0);
});
