import { test, expect } from "@playwright/test";
import { readDemoAccount } from "./e2e-helpers";

test("a blocked execution clears an earlier successful response", async ({ page }) => {
  const demo = readDemoAccount();
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(demo.email);
  await page.getByLabel("Password", {exact:true}).fill(demo.password);
  await page.getByRole("button", {name:"Sign in",exact:true}).click();
  await page.getByRole("link", {name:"API Studio",exact:true}).click();
  let sends = 0;
  await page.route("**/api/gateway/workspaces/*/execute", route => {
    sends++;
    return route.fulfill({status:sends === 1 ? 200 : 422, contentType:"application/json", body:JSON.stringify(sends === 1 ? {data:{id:999999, name:"Test",method:"GET",url:"https://jsonplaceholder.typicode.com/posts/1",status:200,outcome:"passed",duration_ms:20,size_bytes:20,error_code:null,source:"manual",created_at:new Date().toISOString(),assertions:[],response:{headers:{},body:'{"marker":"earlier-success"}',truncated:false}}} : {message:"This destination is not approved by the operator."})});
  });
  await page.getByRole("button", {name:/^Send/}).click();
  await expect(page.locator(".response-heading .badge.mint")).toHaveText("200 OK");
  await page.getByRole("button", {name:/^Send/}).click();
  await expect(page.locator(".response-heading .badge")).toHaveText("blocked");
  await expect(page.getByText("This destination is not approved by the operator.")).toBeVisible();
  await expect(page.locator(".response-heading")).not.toContainText("200 OK");
  await expect(page.locator(".response-content")).toHaveCount(0);

  await page.getByRole("button", { name: "New request tab" }).click();
  await page.locator(".request-panel").getByRole("button", { name: "Body", exact: true }).click();
  await page.getByLabel("Body format").selectOption("json");
  await page.locator(".request-panel .cm-content").last().fill("{ invalid json");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator(".response-heading .badge")).toHaveText("validation error");
  await expect(page.getByText("The JSON request body is invalid. Fix it before sending.")).toBeVisible();
  await expect(page.locator(".response-content")).toHaveCount(0);
});
