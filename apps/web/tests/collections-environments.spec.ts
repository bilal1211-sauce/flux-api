import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { e2eApiOrigin } from "./e2e-helpers";

const email = `phase4-${Date.now()}@example.test`;
const password = "FluxPhase4Test2026!";
let token = "";
let workspaceId = 0;
let collectionId = 0;
let secondCollectionId = 0;
let requestId = 0;
let environmentId = 0;

async function seed(request: APIRequestContext, path: string, data?: unknown) {
  const response = await request.post(
    `${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/${path}`,
    { headers: { Authorization: `Bearer ${token}` }, data },
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()).data;
}

async function signIn(page: Page) {
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible();
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("apiforge-theme", value);
  }, theme);
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `No horizontal overflow at ${width}px` }).toBe(true);
}

test.beforeAll(async ({ request }) => {
  const registered = await request.post(`${e2eApiOrigin}/api/v1/auth/register`, {
    data: { name: "Phase Four QA", email, password, password_confirmation: password },
  });
  expect(registered.status()).toBe(201);
  token = (await registered.json()).data.token;
  const workspaces = await request.get(`${e2eApiOrigin}/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  workspaceId = (await workspaces.json()).data[0].id;
  collectionId = (await seed(request, "collections", { name: "Billing API", description: "Billing routes" })).id;
  secondCollectionId = (await seed(request, "collections", { name: "Archive", description: "Moved requests" })).id;
  const folder = await seed(request, "folders", { name: "Invoices", collection_id: collectionId, parent_id: null });
  const saved = await seed(request, "requests", {
    name: "Sample GET", method: "GET", url: "https://jsonplaceholder.typicode.com/posts/1",
    collection_id: collectionId, folder_id: folder.id, headers: {}, query_params: {}, body: "",
    body_mode: "none", auth_type: "none", auth_config: {}, timeout_ms: 15000,
    pinned: false, sort_order: 10, assertions: [{ type: "status", expected: 200 }],
  });
  requestId = saved.id;
  const environment = await seed(request, "environments", {
    name: "QA staging",
    variables: [
      { key: "base_url", value: "https://jsonplaceholder.typicode.com", is_secret: false },
      { key: "api_token", value: "phase4-secret-do-not-render", is_secret: true },
    ],
  });
  environmentId = environment.id;
});

test("Collections search, rename, move and duplicate stay connected to API Studio", async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All requests" })).toBeVisible();
  await expect(page.getByText("Sample GET", { exact: true })).toBeVisible();
  await expect(page.locator(".flux-tree-pick").filter({ hasText: "Invoices" })).toBeVisible();

  const preview = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(preview, { recursive: true });
  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase4-collections-dark.png"), fullPage: true });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase4-collections-light.png"), fullPage: true });

  await page.getByRole("link", { name: "Open Sample GET in API Studio" }).click();
  await expect(page.getByRole("heading", { name: "Request Studio" })).toBeVisible();
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await page.getByLabel("Filter requests").fill("Sample GET");
  await expect(page.getByText("Sample GET", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rename or move Sample GET" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Request name").fill("Renamed billing request");
  await edit.getByLabel("Collection").selectOption(String(secondCollectionId));
  await edit.getByRole("button", { name: "Save request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Request updated." })).toBeVisible();
  await page.getByRole("link", { name: "API Studio", exact: false }).first().click();
  await expect(page.getByLabel("Request name")).toHaveValue("Renamed billing request");
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await page.getByLabel("Filter requests").fill("Renamed billing request");
  await expect(page.getByText("Renamed billing request", { exact: true })).toBeVisible();
  const authorized = { headers: { Authorization: `Bearer ${token}` } };
  const moved = await page.request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/requests`, authorized);
  const movedRows = (await moved.json()).data;
  expect(movedRows.find((item: { id: number }) => item.id === requestId).collection_id).toBe(secondCollectionId);

  await page.getByRole("button", { name: "Duplicate Renamed billing request" }).click();
  await expect(page.getByText("Copy of Renamed billing request", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Renamed billing request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Renamed billing request", { exact: true })).toHaveCount(0);
  await page.getByLabel("Filter requests").fill("");
  await expect(page.getByText("Copy of Renamed billing request", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await expectNoHorizontalOverflow(page, 390);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: resolve(preview, "phase4-collections-mobile.png"), fullPage: true });
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, width);
  }
});

test("request collection filters reject IDs owned by another workspace", async ({ request }) => {
  const otherEmail = `phase4-other-${Date.now()}@example.test`;
  const registered = await request.post(`${e2eApiOrigin}/api/v1/auth/register`, {
    data: { name: "Other workspace", email: otherEmail, password, password_confirmation: password },
  });
  expect(registered.status()).toBe(201);
  const otherToken = (await registered.json()).data.token;
  const otherWorkspace = await request.get(`${e2eApiOrigin}/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  const otherWorkspaceId = (await otherWorkspace.json()).data[0].id;
  const response = await request.get(`${e2eApiOrigin}/api/v1/workspaces/${otherWorkspaceId}/requests?collection_id=${collectionId}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  expect(response.status()).toBe(422);
});

test("Environments keep secrets masked, preserve unchanged secrets and select the Studio context", async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);
  await page.getByRole("link", { name: "Environments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Environments" })).toBeVisible();
  await page.getByRole("button", { name: /QA staging/ }).click();
  await expect(page.getByRole("heading", { name: "QA staging" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("phase4-secret-do-not-render");
  const preview = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(preview, { recursive: true });
  await setTheme(page, "dark");
  await page.screenshot({ path: resolve(preview, "phase4-environments-dark.png"), fullPage: true });
  await setTheme(page, "light");
  await page.screenshot({ path: resolve(preview, "phase4-environments-light.png"), fullPage: true });

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".flux-env-editor-panel");
  const secret = editor.getByLabel("Value").nth(1);
  await expect(secret).toHaveAttribute("type", "password");
  await expect(secret).toHaveValue("");
  await editor.getByLabel("Value").first().fill("https://api.example.test");
  await editor.getByRole("button", { name: "Save environment" }).click();
  const authorized = { headers: { Authorization: `Bearer ${token}` } };
  const response = await page.request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/environments`, authorized);
  const stored = (await response.json()).data.find((item: { id: number }) => item.id === environmentId);
  expect(stored.variables.find((item: { key: string }) => item.key === "api_token").value).toBeNull();

  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByText(/1 encrypted secret was omitted/)).toBeVisible();
  await page.getByRole("button", { name: "Save environment" }).click();
  await expect(page.getByRole("heading", { name: "QA staging copy" })).toBeVisible();
  await expect(page.getByText("base_url", { exact: true })).toBeVisible();
  await expect(page.getByText("api_token", { exact: true })).toHaveCount(0);
  const environments = await page.request.get(`${e2eApiOrigin}/api/v1/workspaces/${workspaceId}/environments`, authorized);
  const duplicateId = (await environments.json()).data.find((item: { name: string }) => item.name === "QA staging copy").id;
  await page.getByRole("link", { name: /Use in API Studio/ }).click();
  await expect(page.getByLabel("Execution environment")).toHaveValue(String(duplicateId));

  await page.getByRole("link", { name: "Environments", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await expectNoHorizontalOverflow(page, 390);
  await page.screenshot({ path: resolve(preview, "phase4-environments-mobile.png"), fullPage: true });
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, width);
  }
});
