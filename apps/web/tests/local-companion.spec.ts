import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { e2eApiOrigin } from "./e2e-helpers";

const appOrigin = new URL(process.env.E2E_BASE_URL || "").origin;
const apiOrigin = e2eApiOrigin;
const password = "LocalRunTest2026!";
const email = `local-e2e-${Date.now()}@example.test`;
const token = randomBytes(32).toString("base64url");
let environmentName: string;
let target: Server;
let targetPort: number;
let companion: { server: Server; token: string; start: () => Promise<unknown> };

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const registered = await request.post(`${apiOrigin}/api/v1/auth/register`, {
    data: { name: "Local companion test", email, password, password_confirmation: password },
  });
  expect(registered.status()).toBe(201);
  const apiToken = (await registered.json()).data.token as string;
  const headers = { Authorization: `Bearer ${apiToken}` };
  const workspaces = await request.get(`${apiOrigin}/api/v1/workspaces`, { headers });
  const workspaceId = (await workspaces.json()).data[0].id as number;
  environmentName = `Local companion ${Date.now()}`;
  const environment = await request.post(`${apiOrigin}/api/v1/workspaces/${workspaceId}/environments`, {
    headers,
    data: { name: environmentName, variables: [{ key: "local_token", value: token, is_secret: true }] },
  });
  expect(environment.status()).toBe(201);

  target = createServer((incoming, response) => {
    const url = new URL(incoming.url || "/", `http://${incoming.headers.host}`);
    response.writeHead(200, { "Content-Type": "application/json", "X-Echo-Token": url.searchParams.get("token") || "" });
    response.end(JSON.stringify({ token: url.searchParams.get("token"), authorization: incoming.headers.authorization }));
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = (target.address() as { port: number }).port;
  const companionModule = await import(pathToFileURL(resolve(process.cwd(), "../../scripts/companion.mjs")).href) as { createCompanion: (options: { token: string; origins: string[]; allowLocalhost: boolean; port: number }) => typeof companion };
  companion = companionModule.createCompanion({ token: randomBytes(32).toString("base64url"), origins: [appOrigin], allowLocalhost: true, port: 8102 });
  await companion.start();
});

test.afterAll(async () => {
  companion?.server.closeAllConnections();
  await new Promise<void>((resolve) => companion?.server.close(() => resolve()) || resolve());
  if (target?.listening) await new Promise<void>((resolve) => target.close(() => resolve()));
});

test("Studio pairs an explicit local companion, redacts its response and records local history", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "API Studio", exact: true }).click();
  await page.locator(".execution-mode-toggle").getByRole("button", { name: "Local" }).click();
  await page.getByLabel(/This session.s companion token/).fill(companion.token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/Connected · localhost APIs are authorized/)).toBeVisible();

  await page.getByLabel("Request URL").fill(`http://127.0.0.1:${targetPort}/echo?token={{local_token}}`);
  await page.getByLabel("Execution environment").selectOption({ label: environmentName });
  await page.locator(".request-panel .editor-tabs").getByRole("button", { name: /Headers/ }).click();
  await page.locator(".request-panel .cm-content").fill('{"Authorization":"Bearer {{local_token}}"}');
  await page.getByRole("button", { name: /^Send/ }).click();
  await page.getByRole("dialog", { name: "Enter local environment secrets" }).getByLabel("local_token").fill(token);
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.locator(".response-heading .badge").filter({ hasText: "200 OK" })).toBeVisible();
  await expect(page.locator(".response-content")).toContainText("[REDACTED]");
  await expect(page.locator(".response-content")).not.toContainText(token);

  await page.getByRole("link", { name: "Run History", exact: true }).click();
  await page.getByLabel("Filter by execution mode").selectOption("local");
  await expect(page.getByText("Local execution").first()).toBeVisible();
  await page.getByRole("button", { name: /^Inspect run/ }).first().click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Local");
  await expect(detail).not.toContainText(token);
  await detail.getByRole("button", { name: "Close dialog" }).click();
});
