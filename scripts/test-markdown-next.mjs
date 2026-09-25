import assert from "node:assert/strict";

/** Inspect the final DOM, independently of whether CSP would block execution. */
async function assertMarkdown(page, selector) {
  const article = page.locator(selector);
  assert.equal(await article.locator("h1").last().textContent(), "Markdown preview");
  assert.equal(await article.locator("strong").textContent(), "strong");
  assert.equal(await article.locator("em").textContent(), "emphasis");
  assert.equal(await article.locator("ol").getAttribute("start"), "3");
  assert.equal(await article.locator("blockquote").textContent(), "\nA quotation\n");
  assert.equal(await article.locator("pre code").textContent(), "<img src=x onerror=alert(1)>\n");
  assert.equal(await article.locator("a").count(), 1);
  assert.equal(await article.locator("a").getAttribute("href"), "/markdown?visited=yes");
  assert.equal(await article.locator("a").getAttribute("rel"), "nofollow noopener noreferrer");
  assert.equal(await article.locator("img").count(), 1);
  assert.equal(await article.locator("img").getAttribute("src"), "/favicon.ico");
  assert.equal(await article.locator("img").getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(await article.locator("script,style,svg,math,form,input,iframe,[id],[name],[class],[style],[onerror],[onload],[srcset],[target]").count(), 0);
  const text = await article.textContent();
  for (const retained of ["Mixed script", "Encoded script", "Protocol relative", "Data link", "Blob link", "Fragment", "Relative", "Rejected picture", "Rejected remote", "Malformed nesting remains text.", "{globalThis.markdownAttacked = true}"]) {
    assert(text.includes(retained), `Missing useful fallback text: ${retained}`);
  }
}

/** Exercise production Next server/Edge rendering, hydration, updates and real navigation. */
export async function verifyMarkdown(browser, origin, label) {
  for (const route of ["markdown", "markdown-edge"]) {
    for (const reportOnly of [true, false]) {
      const address = `${origin}/${route}${reportOnly ? "?report-only" : ""}`;
      const response = await fetch(address);
      assert.equal(response.status, 200, `${label}: ${route} SSR failed`);
      assert.equal(response.headers.has("content-security-policy"), !reportOnly);
      assert.equal(response.headers.has("content-security-policy-report-only"), reportOnly);
      // Disable JavaScript so hydration cannot replace or repair incorrect server output.
      const serverPage = await browser.newPage({javaScriptEnabled: false});
      try {
        await serverPage.goto(address);
        await assertMarkdown(serverPage, "#server-markdown");
        await assertMarkdown(serverPage, "#client-markdown");
      } finally { await serverPage.close(); }
      const page = await browser.newPage();
      const errors = [];
      const hostileRequests = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error" && /hydration|hydrating|did not match/i.test(message.text())) errors.push(message.text());
      });
      page.on("request", request => {
        if (request.url().includes("attacker.invalid")) hostileRequests.push(request.url());
      });
      try {
        await page.goto(address);
        await page.locator("#markdown-ready").filter({hasText: "ready"}).waitFor();
        await assertMarkdown(page, "#server-markdown");
        await assertMarkdown(page, "#client-markdown");
        await page.getByRole("button", {name: "Update Markdown"}).click();
        await page.locator("#client-markdown h1").first().filter({hasText: "Updated document"}).waitFor();
        await assertMarkdown(page, "#client-markdown");
        assert.equal(await page.evaluate(() => globalThis.markdownAttacked), undefined);
        assert.deepEqual(hostileRequests, [], `${label}: discarded content made requests`);
        assert.deepEqual(errors, [], `${label}: Markdown hydration/runtime errors`);
        await Promise.all([
          page.waitForURL(`${origin}/markdown?visited=yes`),
          page.locator("#client-markdown a").click(),
        ]);
      } finally { await page.close(); }
    }
  }
  console.log(`${label}: SafeMarkdown Node/Edge SSR, hydration, updates and URLs passed with report-only/enforced CSP`);
}
