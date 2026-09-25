import {test} from "next-xss-sbyd/playwright";
import {expect} from "@playwright/test";

test("production hydration, styles, navigation and fresh response nonces", async ({page, csp}) => {
  await page.goto("/");
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  await expect(page.locator("html")).toHaveAttribute("data-authorized", "yes");
  await expect(page.getByRole("heading")).toHaveCSS("color", "rgb(12, 34, 56)");
  await page.getByRole("button", {name: "Count 0"}).click();
  await expect(page.getByRole("button", {name: "Count 1"})).toBeVisible();
  const firstNonce = await page.locator("#authorized").evaluate((script) => script.nonce);
  await page.evaluate(() => { document.documentElement.dataset.documentMarker = "original"; });
  await page.getByRole("link", {name: "Second", exact: true}).click();
  await expect(page.getByRole("heading")).toHaveText("Second page");
  await expect(page.locator("html")).toHaveAttribute("data-document-marker", "original");
  await expect(page.getByRole("button", {name: "Count 1"})).toBeVisible();
  await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
  expect(await page.locator("#authorized").evaluate((script) => script.nonce)).toBe(firstNonce);
  await csp.flush();
  await page.reload();
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  expect(await page.locator("#authorized").evaluate((script) => script.nonce)).not.toBe(firstNonce);
  await expect(page.getByRole("button", {name: "Count 0"})).toBeVisible();
  await expect(page.getByRole("heading")).toHaveCSS("color", "rgb(12, 34, 56)");
});

test("FAIL automatic initial violation without requesting csp", async ({page}) => {
  await page.goto("/violation");
  await expect(page.getByRole("heading")).toHaveText("Violation page");
  await expect(page.locator("html")).not.toHaveAttribute("data-unexpected", "yes");
});
