import { test, expect } from "@playwright/test";

test("signup, encrypted environment, team invitation and OpenAPI import", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Workspace builder");
  await page
    .getByLabel("Email address")
    .fill(`builder-${Date.now()}@example.test`);
  await page.getByLabel(/^Password/).fill("BuilderPassword2026!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("BuilderPassword2026!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Environments", exact: true }).click();
  await page.getByRole("button", { name: "New environment" }).click();
  await page.getByLabel("Environment name").fill("Private staging");
  await page.getByRole("button", { name: "Add variable" }).click();
  await page.getByLabel("Variable name").fill("token");
  await page.getByLabel("Value", { exact: true }).fill("browser-secret-test-987");
  await page.getByLabel("Secret", { exact: true }).check();
  await page.getByRole("button", { name: "Save environment" }).click();
  const privateEnvironment = page.getByRole("button", { name: /^Private staging/ });
  await expect(privateEnvironment).toBeVisible();
  await privateEnvironment.click();
  await expect(
    page.getByRole("heading", { name: "Private staging" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Private staging/ }).click();
  await expect(
    page.getByRole("heading", { name: "Private staging" }),
  ).toBeVisible();
  await expect(
    page.getByText("browser-secret-test-987", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Value", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Team & Access", exact: true })
    .click();
  await page.getByRole("button", { name: "Invite member" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Email address")
    .fill("invited@example.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("textbox", { name: "Invitation link" })).toHaveValue(
    /\/settings#invite=[A-Za-z0-9]{48}$/,
  );
  await expect(
    page.getByText("invited@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Import OpenAPI" }).click();
  await page.getByLabel("Or paste your specification").fill(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Imported users API", version: "1.0" },
      servers: [{ url: "https://jsonplaceholder.typicode.com" }],
      paths: {
        "/users": {
          get: {
            summary: "Imported list users",
            responses: { "200": { description: "Success" } },
          },
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Import collection" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Imported users API/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Imported list users", { exact: true }),
  ).toBeVisible();
});
