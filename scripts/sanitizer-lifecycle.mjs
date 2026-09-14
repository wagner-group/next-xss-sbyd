import assert from "node:assert/strict";

/** Verify the real production SSR/hydration and browser-fetch lifecycle. */
export async function verifySanitizerLifecycle(browser, origin, fixture) {
  const paths = ["/sanitizer-lifecycle", ...(fixture.pages ? ["/legacy-sanitizer"] : [])];
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`);
    const ssr = await response.text();
    assert.equal(response.status, 200, `${fixture.name}${path}: SSR failed`);
    assert.match(ssr, /render-clean/);
    assert.match(ssr, /<mark>visible<\/mark>/);
    assert.match(ssr, /id="article-loading"/);
    const page = await browser.newPage();
    const errors = [];
    const reports = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|hydrating|did not match/i.test(message.text())) errors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.resourceType() === "cspreport") reports.push(request.url());
    });
    try {
      await page.goto(`${origin}${path}`, {waitUntil: "domcontentloaded"});
      await page.locator("#article mark").first().waitFor();
      assert.match(await page.locator("#article").textContent(), /first article/);
      assert.equal(await page.locator("#article mark").count(), 2);
      assert.equal(await page.locator("#article [data-highlight-id], #article script, #article [onerror]").count(), 0);
      assert.equal(await page.locator("#article img").getAttribute("src"), "/article.png");
      assert.equal(await page.locator("#article img").getAttribute("alt"), "A mountain");
      assert.equal(await page.locator("#article audio[controls][preload=none], #article video[controls][preload=none]").count(), 2);
      await page.getByText("Imported marker", {exact: true}).click();
      assert.equal(await page.locator("#active-record").textContent(), "none");
      await page.locator("#article mark").first().click();
      assert.equal(await page.locator("#active-record").textContent(), "saved-record");
      assert.equal(await page.locator("#activations").textContent(), "1");
      await page.getByText("Restore again", {exact: true}).click();
      await page.getByText("Restore again", {exact: true}).click();
      assert.equal(await page.locator("#article mark").count(), 2);
      await page.locator("#article mark").first().click();
      assert.equal(await page.locator("#activations").textContent(), "2", "Repeated effects duplicated a listener");
      const previous = await page.locator("#article mark").first().elementHandle();
      await page.getByText("Toggle article", {exact: true}).click();
      assert.equal(await page.locator("#article").count(), 0);
      await previous.evaluate((marker) => marker.dispatchEvent(new MouseEvent("click", {bubbles: true})));
      assert.equal(await page.locator("#activations").textContent(), "2", "Detached marker retained authority");
      await page.getByText("Toggle article", {exact: true}).click();
      assert.equal(await page.locator("#article mark").count(), 2);
      const slowRequest = page.waitForRequest((request) => request.url().includes("name=slow"));
      await page.getByText("Slow article", {exact: true}).click();
      await slowRequest;
      await page.locator("#article-loading").waitFor();
      await page.getByText("Replace article", {exact: true}).click();
      await page.waitForFunction(() => document.querySelector("#article")?.textContent?.includes("second article"));
      await page.waitForTimeout(850);
      assert.match(await page.locator("#article").textContent(), /second article/);
      assert.equal(await page.locator("#article mark").count(), 2);
      await page.reload({waitUntil: "domcontentloaded"});
      await page.locator("#article mark").first().waitFor();
      assert.match(await page.locator("#article").textContent(), /first article/);
      assert.equal(await page.locator("#article mark").count(), 2);
      await page.locator("#article mark").first().click();
      assert.equal(await page.locator("#active-record").textContent(), "saved-record");
      assert.equal(await page.evaluate(() => globalThis.__LIFECYCLE_XSS__), undefined);
      assert.deepEqual(errors, [], `${fixture.name}${path}: hydration/runtime errors`);
      console.log(`${fixture.name}${path}: SSR, hydration, fetch, restoration, replacement, stale fetch, repeat and cleanup passed; ${reports.length} CSP reports observed separately.`);
    } finally {
      await page.close();
    }
  }
}
