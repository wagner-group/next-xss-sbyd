import assert from "node:assert/strict";

/** Observe browser CSP events before any application script, without altering styling APIs. */
function observePolicy() {
  globalThis.__styleViolations = [];
  globalThis.__styleAction = "load";
  globalThis.__insertedStyles = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLStyleElement) {
          globalThis.__insertedStyles.push({nonce: node.nonce, text: node.textContent});
        }
      }
    }
  }).observe(document, {subtree: true, childList: true});
  const styleIds = new WeakMap();
  let nextStyleId = 1;
  document.addEventListener("securitypolicyviolation", (event) => {
    const style = event.target instanceof HTMLStyleElement ? event.target : undefined;
    if (style && !styleIds.has(style)) styleIds.set(style, nextStyleId++);
    globalThis.__styleViolations.push({
      directive: event.effectiveDirective,
      disposition: event.disposition,
      page: event.documentURI,
      action: globalThis.__styleAction,
      source: event.sourceFile,
      line: event.lineNumber,
      column: event.columnNumber,
      blockedURI: event.blockedURI,
      target: event.target instanceof Element ? event.target.tagName : "Document",
      id: event.target instanceof Element ? event.target.id : "",
      sample: event.sample,
      styleId: style ? styleIds.get(style) : undefined,
      stylePrefix: style?.textContent.slice(0, 64),
    });
  });
}

async function action(page, name) {
  await page.evaluate((value) => { globalThis.__styleAction = value; }, name);
}

async function css(locator, property) {
  return locator.evaluate((element, name) => getComputedStyle(element)[name], property);
}

async function verifyImages(page) {
  for (const id of ["intrinsic-image", "fill-image"]) {
    const image = page.getByTestId(id);
    await image.waitFor();
    assert.match(await image.getAttribute("style"), /color:\s*transparent/, `${id}: Next image style missing`);
    assert.ok(await image.getAttribute("alt"), `${id}: missing alt`);
    assert.match(await image.getAttribute("src"), /^\/_next\/image\?/, `${id}: optimizer URL missing`);
    const candidates = (await image.getAttribute("srcset"))?.split(", ") ?? [];
    assert.ok(candidates.length >= 2, `${id}: responsive srcSet missing`);
    for (const candidate of candidates) {
      const url = new URL(candidate.split(" ")[0], page.url());
      assert.equal(url.pathname, "/_next/image");
      assert.equal(url.searchParams.get("url"), "/csp-image.png");
    }
    if (id === "fill-image") assert.equal(await image.getAttribute("sizes"), "240px");
    await page.waitForFunction((testId) => {
      const image = document.querySelector(`[data-testid="${testId}"]`);
      return image?.complete && image.naturalWidth > 0;
    }, id);
    const box = await image.boundingBox();
    assert.ok(Math.abs(box.width - 240) < 1 && Math.abs(box.height - 160) < 1, `${id}: ${JSON.stringify(box)}`);
  }
  const image = await page.getByTestId("fill-image").boundingBox();
  const frame = await page.getByTestId("fill-frame").boundingBox();
  assert.ok(Math.abs(image.x - frame.x) < 1 && Math.abs(image.y - frame.y) < 1, "fill placement changed");
  assert.equal(await css(page.getByTestId("fill-image"), "objectFit"), "cover");
  assert.equal(await css(page.getByTestId("fill-image"), "objectPosition"), "25% 50%");
}

async function verifyLibraryAndDynamicStyles(page) {
  const input = page.getByTestId("dropzone-input");
  assert.ok(await input.getAttribute("style"), "dropzone generated styles missing");
  assert.equal(await css(input, "height"), "0px");
  assert.equal(await css(input, "width"), "0px");
  const picker = page.waitForEvent("filechooser");
  await page.getByText("Choose or drop files", {exact: true}).click();
  await (await picker).setFiles({name: "csp-upload.txt", mimeType: "text/plain", buffer: Buffer.from("real upload")});
  await page.waitForFunction(() => document.querySelector('[data-testid="uploaded-files"]')?.textContent === "csp-upload.txt");
  for (let count = 1; count <= 6; count += 1) {
    const columns = page.getByTestId(`masonry-${count}`).locator(":scope > div");
    assert.equal(await columns.count(), count);
    const boxes = await columns.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {width: box.width, x: box.x, top: box.top, style: element.getAttribute("style")};
    }));
    for (let index = 0; index < boxes.length; index += 1) {
      assert.ok(Math.abs(boxes[index].width - 600 / count) < 1, `masonry ${count} width`);
      assert.match(boxes[index].style, /width:/);
      assert.equal(boxes[index].top, boxes[0].top);
      assert.ok(Math.abs(boxes[index].x - boxes[0].x - index * 600 / count) < 1, `masonry ${count} placement`);
    }
  }
  const label = page.locator("[cmdk-label]");
  assert.equal(await css(label, "width"), "1px");
  assert.equal(await css(label, "height"), "1px");
  assert.equal(await css(label, "position"), "absolute");
  await page.getByRole("combobox", {name: "Search commands", exact: true}).fill("Save");
  await page.getByRole("option", {name: "Open", exact: true}).waitFor({state: "hidden"});
  assert.equal(await page.locator("[cmdk-item]").count(), 1);
  assert.equal(await page.locator("[cmdk-list]").textContent(), "Save");
  assert.equal(await css(page.getByTestId("bounded-style"), "padding"), "4px");
  assert.equal(await css(page.getByTestId("dynamic-indent"), "paddingLeft"), "24px");
  const indentation = page.getByRole("spinbutton", {name: "Indentation"});
  await indentation.fill("73");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="dynamic-indent"]')).paddingLeft === "73px");
  for (const invalid of ["", "-1", "161"]) {
    await indentation.fill(invalid);
    await page.getByTestId("dynamic-indent").click();
    assert.equal(await css(page.getByTestId("dynamic-indent"), "paddingLeft"), "73px");
  }
  await indentation.fill("0");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="dynamic-indent"]')).paddingLeft === "0px");
  await indentation.fill("160");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="dynamic-indent"]')).paddingLeft === "160px");
  assert.equal(await page.getByTestId("native-size").getAttribute("size"), "12");
  assert.equal(await page.getByTestId("native-size").getAttribute("style"), null);
  assert.equal(await css(page.getByTestId("svg-shape"), "fill"), "rgb(19, 103, 138)");
  assert.equal(await css(page.getByTestId("svg-shape"), "strokeWidth"), "2px");
}

async function verifyDialog(page) {
  const trigger = page.getByRole("button", {name: "Open dialog", exact: true});
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.waitForFunction(() => getComputedStyle(document.body).overflow === "hidden");
  assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), "dialog did not receive focus");
  const nonce = await page.getByTestId("style-provider").getAttribute("data-document-nonce");
  const singleton = await page.locator("style").evaluateAll((elements) => elements
    .filter((element) => element.textContent.includes("data-scroll-locked"))
    .map((element) => ({nonce: element.nonce, rules: element.sheet?.cssRules.length ?? 0})));
  assert.ok(singleton.length > 0, "scroll-lock singleton missing");
  assert.ok(singleton.every((style) => style.nonce === nonce && style.rules > 0), "singleton stylesheet not authorized");
  await page.getByRole("button", {name: "Close dialog", exact: true}).click();
  await dialog.waitFor({state: "hidden"});
  await page.waitForFunction(() => getComputedStyle(document.body).overflow !== "hidden");
  await page.waitForFunction(() => document.activeElement?.textContent === "Open dialog");
}

async function verifyNegativeControls(page, reportOnly, delivered) {
  await action(page, "negative-controls");
  const before = await page.evaluate(() => globalThis.__styleViolations.length);
  const deliveredBefore = delivered.length;
  const duplicateHandlerReport = reportOnly && page.context().browser().browserType().name() === "webkit";
  const expectedDirectives = ["script-src-attr", "style-src-elem"];
  // WebKit reports both handler compilation and invocation in report-only mode.
  if (duplicateHandlerReport) expectedDirectives.push("script-src-attr");
  await page.evaluate(() => {
    const attribute = document.createElement("div");
    attribute.id = "attribute-control";
    attribute.textContent = "Allowed attribute";
    document.body.append(attribute);
    attribute.setAttribute("style", "padding-left: 91px");
    const style = document.createElement("style");
    style.textContent = "#unauthorized-element { padding-left: 92px }";
    const target = document.createElement("div");
    target.id = "unauthorized-element";
    target.textContent = "Blocked stylesheet";
    document.body.append(target, style);
    const handler = document.createElement("button");
    handler.id = "unauthorized-handler";
    handler.textContent = "Blocked handler";
    handler.setAttribute("onclick", "globalThis.__unauthorizedHandler = true");
    document.body.append(handler);
    const property = document.createElement("div");
    property.id = "property-control";
    property.style.paddingLeft = "93px";
    const cssText = document.createElement("div");
    cssText.id = "css-text-control";
    cssText.style.cssText = "padding-left: 94px";
    document.body.append(property, cssText);
  });
  await page.locator("#unauthorized-handler").click();
  await page.waitForFunction((count) => globalThis.__styleViolations.length >= count, before + expectedDirectives.length);
  assert.equal(await css(page.locator("#attribute-control"), "paddingLeft"), "91px");
  assert.equal(await css(page.locator("#unauthorized-element"), "paddingLeft"), reportOnly ? "92px" : "0px");
  assert.equal(await page.evaluate(() => globalThis.__unauthorizedHandler === true), reportOnly);
  assert.equal(await css(page.locator("#property-control"), "paddingLeft"), "93px");
  // Measured on the pinned Chromium/WebKit builds. Keep this distinct from setAttribute.
  assert.equal(await css(page.locator("#css-text-control"), "paddingLeft"), "94px");
  const violations = await page.evaluate((count) => globalThis.__styleViolations.slice(count), before);
  assert.deepEqual(violations.map((event) => event.directive).sort(), expectedDirectives.sort());
  assert.ok(violations.every((event) => event.disposition === (reportOnly ? "report" : "enforce")));
  // Wait for real report POST responses, not merely a quiet console after the click.
  // Chromium did not deliver Reporting API POSTs on this local HTTP fixture.
  // Enforcing report-uri delivers real POSTs; verify report-only delivery on HTTPS staging.
  if (!reportOnly || duplicateHandlerReport) await waitForReports(delivered, ["script-src-attr", "style-src-elem"], deliveredBefore);
}

async function waitForReports(delivered, directives, offset = 0) {
  const deadline = Date.now() + 10_000;
  while (!directives.every((directive) => delivered.slice(offset).some((report) => report.directive === directive && report.status === 204))) {
    assert.ok(Date.now() < deadline, `CSP report delivery missing: ${JSON.stringify(delivered)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function verifyStoredTheme(browser, origin) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      globalThis.__initialThemes = [];
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target === document.documentElement) {
            globalThis.__initialThemes.push({
              theme: document.documentElement.dataset.theme,
              hydrated: document.querySelector('[data-testid="hydrated"]')?.textContent === "ready",
            });
          }
        }
      }).observe(document, {subtree: true, attributes: true, attributeFilter: ["data-theme"]});
    });
    const response = await page.goto(`${origin}/csp-styles`);
    await page.waitForFunction(() => document.querySelector('[data-testid="hydrated"]')?.textContent === "ready");
    const initial = await page.evaluate(() => globalThis.__initialThemes[0]);
    assert.deepEqual(initial, {theme: "dark", hydrated: false}, "stored theme was not applied before hydration");
    assert.equal(await css(page.locator("body"), "backgroundColor"), "rgb(22, 33, 44)");
    const expectedNonce = /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"])[1];
    const themeScript = await page.locator("script").evaluateAll((elements) => elements
      .filter((element) => element.textContent.includes("localStorage") && element.textContent.includes("data-theme"))
      .map((element) => element.nonce));
    assert.deepEqual(themeScript, [expectedNonce]);
  } finally {
    await context.close();
  }
}

/** Exercise production styles separately from legacy compatibility and raw diagnostic cases. */
export async function verifyCspStyles(browser, origin) {
  console.log(`CSP styles: ${browser.browserType().name()} ${browser.version()}`);
  await verifyStoredTheme(browser, origin);
  const firstPaint = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await firstPaint.newPage();
    await page.goto(`${origin}/csp-styles`);
    await verifyImages(page);
    assert.equal(await css(page.getByTestId("dropzone-input"), "height"), "0px");
    assert.equal(await css(page.getByTestId("dropzone-input"), "opacity"), "0");
    assert.equal(await css(page.getByTestId("dynamic-indent"), "paddingLeft"), "24px");
    assert.equal(await page.getByRole("button", {name: "Open dialog"}).count(), 1, "closed Dialog trigger must retain SSR");
    assert.equal(await page.getByRole("combobox", {name: "Fruit"}).count(), 1, "Select must retain SSR");
    assert.equal(await css(page.locator("[cmdk-label]"), "width"), "1px");
    assert.equal(await page.getByTestId("hydrated").textContent(), "pending");
  } finally {
    await firstPaint.close();
  }
  for (const reportOnly of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(observePolicy);
    const errors = [];
    const delivered = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/hydration|hydrating|minified React error/i.test(message.text())) errors.push(message.text());
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/csp-report" && response.request().method() === "POST") {
        const payload = response.request().postDataJSON();
        const bodies = Array.isArray(payload) ? payload.map((entry) => entry.body) : [payload["csp-report"] ?? payload.body];
        if (bodies.some((body) => !body)) {
          errors.push(`Unexpected report body: ${JSON.stringify(payload)}`);
          return;
        }
        delivered.push(...bodies.map((body) => ({directive: body["effective-directive"] ?? body.effectiveDirective, status: response.status(), ...(response.status() === 204 ? {} : {payload})})));
      }
    });
    try {
      const response = await page.goto(`${origin}/csp-styles${reportOnly ? "?report-only=1" : ""}`);
      const headers = response.headers();
      const policy = headers[reportOnly ? "content-security-policy-report-only" : "content-security-policy"];
      assert.ok(policy?.includes("'strict-dynamic'"));
      assert.match(policy, /style-src-attr 'unsafe-inline'/);
      assert.doesNotMatch(policy, /unsafe-eval/);
      assert.equal(headers[reportOnly ? "content-security-policy" : "content-security-policy-report-only"], undefined);
      await page.waitForFunction(() => document.querySelector('[data-testid="hydrated"]')?.textContent === "ready");
      await verifyImages(page);
      await action(page, "finite-dynamic");
      await verifyLibraryAndDynamicStyles(page);
      await action(page, "dialog");
      await verifyDialog(page);
      await verifyDialog(page);
      await action(page, "select");
      await page.getByRole("combobox", {name: "Fruit"}).click();
      const popup = page.getByRole("listbox");
      await popup.waitFor();
      await page.waitForFunction(() => {
        const wrapper = document.querySelector("[data-radix-popper-content-wrapper]");
        return wrapper && getComputedStyle(wrapper).transform !== "none";
      });
      const popupBox = await popup.boundingBox();
      const triggerBox = await page.getByRole("combobox", {name: "Fruit", includeHidden: true}).boundingBox();
      assert.ok(popupBox.width > 0 && popupBox.height > 0 && popupBox.x >= 0, "select popup not positioned");
      assert.ok(Math.abs(popupBox.x - triggerBox.x) < 2, "select not anchored to trigger");
      assert.equal(await css(popup, "animationName"), "appear");
      await page.getByRole("option", {name: "Banana", exact: true}).click();
      assert.match(await page.getByRole("combobox", {name: "Fruit"}).textContent(), /Banana/);
      await page.getByRole("combobox", {name: "Fruit"}).press("Enter");
      await page.getByRole("option", {name: "Banana", exact: true}).waitFor();
      await page.keyboard.press("Home");
      await page.waitForFunction(() => document.activeElement?.textContent === "Apple");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('[data-testid="selected-fruit"]')?.textContent === "apple");
      await action(page, "tabs-switch");
      await page.getByRole("tab", {name: "Details", exact: true}).click();
      assert.equal(await page.getByRole("tab", {name: "Details", exact: true}).getAttribute("aria-selected"), "true");
      await page.getByRole("tab", {name: "Details", exact: true}).press("ArrowLeft");
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Overview");
      await page.getByRole("tab", {name: "Overview", exact: true}).press("ArrowRight");
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Details");
      assert.match(await page.getByRole("tabpanel").textContent(), /Details/i);
      const toggle = page.getByRole("switch", {name: "Notifications"});
      const previous = await toggle.getAttribute("aria-checked");
      await toggle.click();
      assert.notEqual(await toggle.getAttribute("aria-checked"), previous);
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".switch-thumb")).transform === "matrix(1, 0, 0, 1, 20, 0)");
      await action(page, "theme");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      const themeScript = await page.locator("script").evaluateAll((elements) => elements
        .filter((element) => element.textContent.includes("localStorage") && element.textContent.includes("data-theme"))
        .map((element) => element.nonce));
      assert.deepEqual(themeScript, [/'nonce-([^']+)'/.exec(policy)[1]], "theme anti-flash script not authorized");
      await page.getByRole("button", {name: "Toggle theme"}).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.waitForFunction(() => globalThis.__insertedStyles.some((style) => style.text.startsWith("*,*::before,*::after{")));
      assert.equal(await css(page.locator("body"), "backgroundColor"), "rgb(22, 33, 44)");
      const nonce = /'nonce-([^']+)'/.exec(policy)[1];
      const themeStyles = await page.evaluate(() => globalThis.__insertedStyles.filter((style) => style.text.startsWith("*,*::before,*::after{")));
      assert.ok(themeStyles.every((style) => style.nonce === nonce), "theme transition style lacks document nonce");
      await page.getByRole("button", {name: "Toggle theme"}).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      assert.equal(await css(page.locator("body"), "backgroundColor"), "rgb(255, 255, 255)");
      await page.getByRole("button", {name: "Toggle theme"}).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await action(page, "toast");
      await page.getByRole("button", {name: "Show toast"}).click();
      const toast = page.locator("[data-sonner-toast]");
      await toast.waitFor();
      assert.match(await toast.textContent(), /CSP stylesheet toast/);
      assert.equal(await css(toast, "position"), "absolute");
      assert.notEqual(await css(toast, "backgroundColor"), "rgba(0, 0, 0, 0)");
      await page.waitForFunction(() => {
        const box = document.querySelector("[data-sonner-toast]")?.getBoundingClientRect();
        return box && box.width > 100 && box.height > 20 && box.x >= 0 && box.y >= 0 &&
          box.right <= innerWidth && box.bottom <= innerHeight;
      });
      await toast.getByRole("button", {name: "Close toast"}).click();
      await toast.waitFor({state: "detached"});
      await page.getByRole("button", {name: "Show toast"}).click();
      await toast.waitFor();
      await page.getByRole("button", {name: "Dismiss toast", exact: true}).click();
      await toast.waitFor({state: "detached"});
      await action(page, "navigation");
      await page.getByRole("link", {name: "Next style page"}).click();
      await page.waitForURL("**/csp-styles/next*");
      await verifyDialog(page);
      await page.getByRole("link", {name: "Back to style page"}).click();
      await page.waitForURL("**/csp-styles");
      await verifyDialog(page);
      const announcer = page.locator("next-route-announcer").locator("[role=alert]");
      await announcer.waitFor({state: "attached"});
      assert.equal(await announcer.getAttribute("aria-live"), "assertive");
      assert.equal(await css(announcer, "width"), "1px");
      assert.equal(await css(announcer, "height"), "1px");
      assert.ok((await announcer.textContent()).length > 0, "route announcement missing");
      const observed = await page.evaluate(() => globalThis.__styleViolations);
      console.log("Style recipe reports", JSON.stringify(observed));
      // Sonner 2.0.7 redundantly inserts one stylesheet twice at module evaluation.
      // Its imported CSS works; only these two events on that same element are reviewed.
      assert.equal(observed.length, 2, `unexpected report count: ${JSON.stringify(observed)}`);
      for (const event of observed) {
        assert.equal(event.directive, "style-src-elem", JSON.stringify(event));
        assert.equal(event.disposition, reportOnly ? "report" : "enforce");
        assert.equal(event.action, "load");
        assert.equal(new URL(event.page).pathname, "/csp-styles");
        assert.equal(new URL(event.source).origin, origin);
        assert.match(new URL(event.source).pathname, /^\/_next\/static\/chunks\/[^/]+\.js$/);
        assert.equal(event.blockedURI, "inline");
        assert.equal(event.target, "STYLE");
        assert.equal(event.stylePrefix, "[data-sonner-toaster][dir=ltr],html[dir=ltr]{--toast-icon-margin");
      }
      assert.equal(observed[0].styleId, observed[1].styleId);
      assert.equal(observed[0].source, observed[1].source);
      if (!reportOnly || browser.browserType().name() === "webkit") await waitForReports(delivered, ["style-src-elem"]);
      await verifyNegativeControls(page, reportOnly, delivered);
      assert.deepEqual(errors, [], "hydration/runtime errors");
    } finally {
      await context.close();
    }
  }
}
