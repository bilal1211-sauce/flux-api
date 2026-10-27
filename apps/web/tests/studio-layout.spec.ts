import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readDemoAccount } from "./e2e-helpers";

test("workspace modules fit supported widths and CodeMirror follows the selected theme", async ({
  page,
}) => {
  const account = readDemoAccount();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();

  const routes = [
    "dashboard",
    "studio",
    "collections",
    "environments",
    "monitoring",
    "analytics",
    "history",
    "alerts",
    "reports",
    "settings",
    "audit",
  ];
  let currentRoute = "dashboard";
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of routes) {
    if (route !== currentRoute) {
      const link = page.locator(`.sidebar .nav-link[href="/${route}"]`);
      await link.evaluate((element) => (element as HTMLAnchorElement).click());
      await expect(page).toHaveURL(new RegExp(`/${route}$`));
      currentRoute = route;
    }
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator(".main-content h1")).toBeVisible();
    if (route === "analytics") {
      await expect(
        page.getByRole("heading", { name: "Execution performance" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "HTTP response classes" }),
      ).toBeVisible();
      await expect(page.locator(".analytics-performance-panel")).toBeVisible();
      await page.setViewportSize({ width: 360, height: 900 });
      await page.getByLabel("Analytics period").selectOption("30");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "analytics overflows at 360px",
      ).toBe(true);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${route} overflows at 1440px`,
    ).toBe(true);
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-expanded/);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.locator(".account-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-popover")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio");
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "Request Studio" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Studio overflows at ${width}px`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const previews = process.env.E2E_PREVIEW_DIR || resolve(process.cwd(), "../../docs/previews");
  mkdirSync(previews, { recursive: true });
  const showExplorer = page.getByRole("button", {
    name: "Show collection explorer",
  });
  if (await showExplorer.isVisible()) await showExplorer.click();
  const showContext = page.getByRole("button", { name: "Show context", exact: true });
  if (await showContext.isVisible()) await showContext.click();
  const contextToggle = page.getByRole("button", { name: "Hide context", exact: true });
  await expect(contextToggle).toHaveAttribute("aria-pressed", "true");
  const savedRequest = page.locator(".studio-tree-request").first();
  await expect(savedRequest).toBeVisible();
  const savedRequestLabel = (await savedRequest.innerText())
    .replace(/^[A-Z]+\s+/, "")
    .replace("★", "")
    .trim();
  await savedRequest.click();
  await expect(page.locator(".request-tabs")).toContainText(savedRequestLabel);
  const explorerResizer = page.getByRole("separator", {
    name: "Resize collection explorer",
  });
  const explorerWidth = Number(
    await explorerResizer.getAttribute("aria-valuenow"),
  );
  await explorerResizer.focus();
  await page.keyboard.press("ArrowRight");
  await expect(explorerResizer).toHaveAttribute(
    "aria-valuenow",
    String(explorerWidth + 16),
  );
  const contextResizer = page.getByRole("separator", {
    name: "Resize request context panel",
  });
  const contextWidth = Number(
    await contextResizer.getAttribute("aria-valuenow"),
  );
  await contextResizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(contextResizer).toHaveAttribute(
    "aria-valuenow",
    String(contextWidth + 16),
  );
  const editorResizer = page.getByRole("separator", {
    name: "Resize request editor and response panels",
  });
  const editorHeight = Number(
    await editorResizer.getAttribute("aria-valuenow"),
  );
  await editorResizer.focus();
  await page.keyboard.press("ArrowDown");
  await expect(editorResizer).toHaveAttribute(
    "aria-valuenow",
    String(editorHeight + 16),
  );
  await page
    .getByRole("button", { name: /^Actions for/ })
    .first()
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Duplicate request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Rename or move" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(previews, "fluxapi-studio-dark.png"),
    fullPage: true,
  });
  await contextToggle.click();
  await expect(page.getByRole("button", { name: "Show context", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("complementary", { name: "Request context" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show context", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Request context" }),
  ).toBeVisible();
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect(page.locator(".cm-theme-dark .cm-editor").first()).toBeVisible();
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.locator(".cm-theme-light .cm-editor").first(),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(previews, "fluxapi-studio-light.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const showMobileExplorer = page.getByRole("button", {
    name: "Show collection explorer",
  });
  await showMobileExplorer.click();
  await expect(
    page.getByRole("button", { name: "Close collection explorer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close collection explorer" }).click();
  await expect(page.locator(".studio-collections.drawer-open")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(previews, "fluxapi-studio-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar.open")).toHaveAttribute("role", "dialog");
  await expect(page.locator(".main-shell")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await expect(page.locator(".main-shell")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator('.sidebar.open .nav-link[href="/studio"]').click();
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  expect(errors).toEqual([]);
});
