import { test, expect } from "@playwright/test";
import { e2eApiOrigin, readDemoAccount } from "./e2e-helpers";

test("account recovery, verification, security settings and unsaved drafts", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const demo = readDemoAccount();
  const adminLogin = await request.post(
    `${e2eApiOrigin}/api/v1/auth/login`,
    { data: { email: demo.email, password: demo.password } },
  );
  expect(adminLogin.ok()).toBeTruthy();
  const adminToken = (await adminLogin.json()).data.token;
  const email = `completion-${Date.now()}@example.test`;
  const password = "CompletionPassword2026!";
  const registered = await request.post(
    `${e2eApiOrigin}/api/v1/auth/register`,
    {
      data: {
        name: "Completion engineer",
        email,
        password,
        password_confirmation: password,
      },
    },
  );
  expect(registered.status()).toBe(201);
  async function emailLink(subject: string, path: string) {
    let text = "";
    await expect
      .poll(
        async () => {
          const result = await request.get(
            `${e2eApiOrigin}/api/v1/dev/mail`,
            { headers: { Authorization: `Bearer ${adminToken}` } },
          );
          expect(result.ok()).toBeTruthy();
          const messages = (await result.json()).data as {
            subject: string;
            to: string[];
            text: string;
          }[];
          text =
            messages.find(
              (item) => item.subject === subject && item.to.includes(email),
            )?.text || "";
          return text.includes(path);
        },
        { timeout: 30000 },
      )
      .toBeTruthy();
    return (text.match(/https?:\/\/[^\s<>"')]+/g) || []).find(
      (link) => new URL(link).pathname === path,
    )!;
  }
  await page.goto(
    await emailLink("Verify your APIForge email", "/verify-email"),
  );
  await page
    .getByRole("button", { name: "Verify email address", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("verified");
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("link", { name: "Team & Access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Updated engineer");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Profile updated");
  await page.getByRole("tab", { name: "Workspace preferences", exact: true }).click();
  await page.getByLabel("Workspace display name").fill("Completion workspace");
  await page.getByLabel("Email verified owners").check();
  await page
    .getByRole("button", { name: "Save workspace preferences" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Workspace preferences saved",
  );
  await page.getByRole("tab", { name: "Account", exact: true }).click();
  await page.getByLabel("Current password").fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("ChangedPassword2026!");
  await page.getByLabel("Confirm new password").fill("ChangedPassword2026!");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  await expect(page.getByText("This session", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to FluxAPI" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot your password?" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page.goto(
    await emailLink("Reset your APIForge password", "/reset-password"),
  );
  await page
    .getByLabel("New password", { exact: true })
    .fill("ResetPassword2026!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("ResetPassword2026!");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  expect(new URL(page.url()).hash).toBe("");
  await page
    .getByRole("link", { name: "Back to sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to FluxAPI" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("ResetPassword2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "API Studio", exact: true }).click();
  await page.getByLabel("Request name", { exact: true }).fill("Unsaved draft");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "API Studio", exact: true }).click();
  await expect(page.getByLabel("Request name", { exact: true })).toHaveValue(
    "Unsaved draft",
  );
  await page.getByRole("button", { name: "New request tab" }).click();
  await expect(
    page.getByRole("heading", { name: "No response yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Unsaved draft" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Discard unsaved changes?",
  );
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(
    page.getByRole("button", { name: "Close Unsaved draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Unsaved draft" }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close Unsaved draft" }),
  ).toHaveCount(0);
});
