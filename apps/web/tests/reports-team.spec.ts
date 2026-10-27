import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const email = `phase7-ui-${Date.now()}@example.test`;
const password = "FluxPhase7Test2026!";
const previewDir = process.env.E2E_PREVIEW_DIR;

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("apiforge-theme", value);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function captureScreenshot(page: Page, path: string) {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(viewport.width - 8, viewport.height - 8);
  await page.waitForTimeout(250);
  await page.screenshot({ path, fullPage: true });
}

test("Reports and Team & Access workflows stay scoped, responsive, and theme aware", async ({ page }) => {
  test.setTimeout(180000);
  if (!previewDir) throw new Error("The isolated E2E harness did not provide a screenshot destination.");
  mkdirSync(previewDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Phase Seven owner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reports & integrations" })).toBeVisible();
  await expect(page.locator(".report-stat")).toHaveCount(4);
  await page.getByRole("button", { name: "Create report", exact: true }).first().click();
  await page.getByLabel("Report name").fill("Phase seven review");
  await page.getByLabel("Execution period").selectOption("7");
  await page.getByLabel("Share link expiry").selectOption("24");
  await page.getByRole("button", { name: "Preview report" }).click();
  const reportPreview = page.getByRole("dialog", { name: "Review report preview" });
  await expect(reportPreview).toContainText("Last 7 days");
  await expect(reportPreview).toContainText("No executions in this period");
  await page.getByRole("button", { name: "Create secure link" }).click();
  await expect(page.getByLabel("Report URL")).toHaveValue(/\/report\/[A-Za-z0-9]{48}$/);
  await expect(page.getByRole("status")).toContainText("Secure report link created");
  await expect(page.locator(".report-list-row").filter({ hasText: "Phase seven review" })).toContainText("Active");

  await page.getByRole("button", { name: "Preview Phase seven review" }).click();
  const storedPreview = page.getByRole("dialog", { name: "Preview Phase seven review" });
  await expect(storedPreview).toContainText("No execution data in this snapshot");
  await expect(storedPreview).not.toContainText("token_hash");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Filter reports by status").selectOption("active");
  await expect(page.locator(".report-list-row")).toHaveCount(1);
  await page.getByLabel("Search reports").fill("does not match");
  await expect(page.getByText("No reports match")).toBeVisible();
  await page.getByLabel("Search reports").fill("");
  await page.getByLabel("Filter reports by status").selectOption("all");
  await page.getByRole("button", { name: "Hide report link" }).click();
  await expect(page.getByLabel("Report URL")).toHaveCount(0);
  const reportToast = page.getByRole("button", { name: "Dismiss message" });
  if (await reportToast.isVisible()) await reportToast.click();
  await setTheme(page, "dark");
  await captureScreenshot(page, resolve(previewDir, "reports-desktop-dark.png"));
  await setTheme(page, "light");
  await captureScreenshot(page, resolve(previewDir, "reports-desktop-light.png"));

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await captureScreenshot(page, resolve(previewDir, "reports-390-dark.png"));
  await setTheme(page, "light");
  await captureScreenshot(page, resolve(previewDir, "reports-390-light.png"));
  for (const width of [360, 390, 768, 1024, 1440, 1920]) await assertNoHorizontalOverflow(page, width);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "Revoke Phase seven review" }).click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.locator(".report-list-row").filter({ hasText: "Phase seven review" })).toContainText("Revoked");

  await page.getByRole("link", { name: "Team & Access", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team & Access" })).toBeVisible();
  await expect(page.locator(".team-member-row")).toContainText(email);
  await page.getByRole("button", { name: "Invite member", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Email address").fill(`invited-${Date.now()}@example.test`);
  await page.getByRole("dialog").getByLabel("Workspace role").selectOption("viewer");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("tab", { name: "Invitations" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".team-invitation-row")).toContainText("Pending");
  await expect(page.getByRole("textbox", { name: "Invitation link" })).toHaveValue(/#invite=[A-Za-z0-9]{48}$/);

  await page.getByRole("tab", { name: "Roles & permissions" }).click();
  await expect(page.getByRole("tabpanel", { name: "Roles & permissions" })).toContainText("Platform administrator access is managed separately");
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByRole("button", { name: "Hide invitation link" }).click();
  await expect(page.getByRole("textbox", { name: "Invitation link" })).toHaveCount(0);
  const invitationToast = page.getByRole("button", { name: "Dismiss message" });
  if (await invitationToast.isVisible()) await invitationToast.click();
  await setTheme(page, "dark");
  await captureScreenshot(page, resolve(previewDir, "team-desktop-dark.png"));
  await setTheme(page, "light");
  await captureScreenshot(page, resolve(previewDir, "team-desktop-light.png"));

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await captureScreenshot(page, resolve(previewDir, "team-390-dark.png"));
  await setTheme(page, "light");
  await captureScreenshot(page, resolve(previewDir, "team-390-light.png"));
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await assertNoHorizontalOverflow(page, width);
    for (const label of ["Members", "Invitations", "Roles & permissions", "Workspace preferences", "Account"]) {
      await expect(page.getByRole("tab", { name: label })).toBeInViewport({ ratio: 1 });
    }
  }

  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(page.locator(".team-invitation-row")).toContainText("Revoked");
});
