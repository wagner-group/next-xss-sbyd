import assert from "node:assert/strict";

/** Collect CSP events before hydration, preserving available browser metadata. */
function observeDiagnostics() {
  globalThis.__diagnosticViolations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    globalThis.__diagnosticViolations.push({
      directive: event.effectiveDirective,
      disposition: event.disposition,
      page: event.documentURI,
      source: event.sourceFile,
      line: event.lineNumber,
      column: event.columnNumber,
      blockedURI: event.blockedURI,
      target: event.target instanceof Element ? event.target.tagName : "Document",
      sample: event.sample,
    });
  });
}

async function computed(locator, property) {
  return locator.evaluate((element, name) => getComputedStyle(element)[name], property);
}

/** Verify original library inline styles before and after hydration. */
async function verifyRawLayout(page, beforeHydration = false) {
  const intrinsic = page.getByTestId("raw-intrinsic-image");
  const fill = page.getByTestId("raw-fill-image");
  const label = page.locator("[cmdk-label]");
  await intrinsic.waitFor();
  assert.match(await intrinsic.getAttribute("style"), /color:transparent/);
  assert.equal(await computed(intrinsic, "color"), "rgba(0, 0, 0, 0)");
  const intrinsicBox = await intrinsic.boundingBox();
  assert.equal(intrinsicBox.width, 240, "intrinsic width must be retained");
  assert.equal(intrinsicBox.height, 160, "intrinsic height must be retained");
  assert.match(await fill.getAttribute("style"), /position:absolute/);
  assert.equal(await computed(fill, "position"), "absolute", "raw fill positioning must apply");
  assert.equal(await computed(fill, "objectFit"), "fill");
  const fillBox = await fill.boundingBox();
  const frameBox = await page.getByTestId("raw-fill-frame").boundingBox();
  assert.deepEqual(fillBox, frameBox, "fill image must occupy its parent frame");
  assert.match(await label.getAttribute("style"), /width:1px/);
  assert.equal(await computed(label, "position"), "absolute", "command label must be visually hidden");
  assert.equal((await label.boundingBox()).width, 1);
  const parentBox = await page.getByTestId("raw-masonry").boundingBox();
  const columnWidths = await page.getByTestId("raw-masonry").locator(":scope > .masonry-column")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  assert.equal(columnWidths.length, 3);
  assert.ok(columnWidths.every((width) => Math.abs(width - parentBox.width / 3) < 1), "masonry column widths must apply");
  const rawRadix = page.getByRole("region", {name: "Raw server-rendered Radix"});
  const value = rawRadix.getByRole("combobox", {name: "Raw fruit"}).locator("span").first();
  assert.match(await value.getAttribute("style"), /pointer-events:none/);
  assert.equal(await computed(value, "pointerEvents"), "none", "Select value inline style must apply");
  if (beforeHydration) {
    const nativeSelect = rawRadix.locator("select");
    const nativeSwitch = rawRadix.locator('input[type="checkbox"]');
    assert.equal(await computed(nativeSelect, "position"), "absolute", "SSR native Select must be hidden");
    assert.equal(await computed(nativeSwitch, "opacity"), "0", "SSR Switch input must be hidden");
  }
}

/** Exercise unmodified library output under the default policy. */
export async function verifyCspDiagnostics(browser, origin) {
  const initialContext = await browser.newContext({javaScriptEnabled: false});
  try {
    const initialPage = await initialContext.newPage();
    await initialPage.goto(`${origin}/csp-diagnostics`);
    await verifyRawLayout(initialPage, true);
  } finally {
    await initialContext.close();
  }

  const context = await browser.newContext();
  await context.addInitScript(observeDiagnostics);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/hydration|hydrating|minified React error/i.test(message.text())) errors.push(message.text());
  });
  try {
    const response = await page.goto(`${origin}/csp-diagnostics`);
    assert.match(response.headers()["content-security-policy"], /style-src-attr 'unsafe-inline'/);
    assert.doesNotMatch(response.headers()["content-security-policy"], /unsafe-eval/);
    const input = page.getByRole("combobox", {name: "Raw command menu"});
    await page.locator('[cmdk-item][aria-selected="true"]').waitFor();
    await input.fill("Save");
    await page.getByRole("option", {name: "Open", exact: true}).waitFor({state: "hidden"});
    await page.getByRole("option", {name: "Save", exact: true}).waitFor();
    await verifyRawLayout(page);
    const violations = await page.evaluate(() => globalThis.__diagnosticViolations);
    assert.deepEqual(violations, [], "original SSR styles must not raise CSP reports");

    await page.getByRole("link", {name: "Next diagnostic page"}).click();
    await page.waitForURL("**/csp-diagnostics/next");
    const announcer = page.locator("next-route-announcer").locator("[role=alert]");
    await page.waitForFunction(() => document.querySelector("next-route-announcer")?.shadowRoot
      ?.querySelector('[role="alert"]')?.textContent === "CSP diagnostics after navigation");
    assert.equal(await announcer.getAttribute("aria-live"), "assertive");
    assert.equal(await computed(announcer, "position"), "absolute");
    assert.equal(await computed(announcer, "width"), "1px");
    assert.equal(await computed(announcer, "height"), "1px");
    assert.equal(await computed(announcer, "overflow"), "hidden");
    // Next 16.3.2 uses style.cssText for this client-created shadow element.
    // Chromium/WebKit permit this path; the native accessibility feature stays intact.
    assert.deepEqual(await page.evaluate(() => globalThis.__diagnosticViolations), violations,
      "client navigation introduced an unexplained diagnostic report");
    assert.deepEqual(errors, [], "raw diagnostics must still hydrate without runtime errors");
    console.log(`CSP diagnostics: ${browser.browserType().name()} ${browser.version()}: ` +
      "original SSR styles applied before hydration and after filtering; native route announcement hidden and functional");
  } finally {
    await context.close();
  }
}
