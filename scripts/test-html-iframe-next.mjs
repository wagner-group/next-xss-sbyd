import assert from "node:assert/strict";

/** Verify conditional exports, the client boundary and hydration in a production Next app. */
export async function verifyHtmlIframe(browser, origin, label) {
  const response = await fetch(`${origin}/html-iframe`);
  assert.equal(response.status, 200, `${label}: iframe SSR failed`);
  const markup = await response.text();
  assert.match(markup, /id="server-frame"/);
  assert.match(markup, /id="client-frame"/);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /hydration|hydrating|did not match/i.test(message.text())) errors.push(message.text());
  });
  try {
    await page.goto(`${origin}/html-iframe`);
    await page.locator("#frame-ready").filter({hasText: "ready"}).waitFor();
    for (const [id, text] of [["server-frame", "Server preview"], ["client-frame", "Client preview"]]) {
      const body = page.frameLocator(`#${id}`).locator("body");
      await body.filter({hasText: text}).waitFor();
      assert.equal(await page.locator(`#${id}`).getAttribute("sandbox"), "");
      assert.equal(await page.frameLocator(`#${id}`).locator("script").count(), 0);
      assert.equal(await page.frameLocator(`#${id}`).locator('meta[name="referrer"]').getAttribute("content"), "no-referrer");
    }
    const body = page.frameLocator("#client-frame").locator("body");
    await body.evaluate(element => { element.dataset.marker = "preserved"; });
    await page.getByRole("button", {name: "Parent render 0"}).click();
    await page.getByRole("button", {name: "Parent render 1"}).waitFor();
    await page.waitForTimeout(200);
    assert.equal(await body.getAttribute("data-marker"), "preserved");
    await page.getByRole("button", {name: "Update document"}).click();
    await body.filter({hasText: "Updated preview"}).waitFor();
    assert.equal(await page.evaluate(() => window.attacked), undefined);
    assert.deepEqual(errors, [], `${label}: iframe hydration/runtime errors`);
    console.log(`${label}: SafeHtmlIframe server/client rendering, refs, stable document and updates passed`);
  } finally { await page.close(); }
}
