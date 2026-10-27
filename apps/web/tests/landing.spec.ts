import { test, expect } from "@playwright/test";

test("public landing page opens the existing workspace sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make the request.Know the response.",
  );
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/\/#workflow$/);
  await expect(
    page.getByRole("heading", { name: "A clearer way to work with APIs." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open your workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to FluxAPI" }),
  ).toBeVisible();
});
