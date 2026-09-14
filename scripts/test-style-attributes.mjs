import assert from "node:assert/strict";

async function verifyBaseline(page, label) {
  const result = await page.evaluate(() => {
    const module = document.querySelector('[data-style-example="module"]');
    const fixed = document.querySelector('[data-style-example="fixed"]');
    const dynamic = document.querySelector('[data-style-example="dynamic"]');
    return {
      moduleColor: getComputedStyle(module).color,
      modulePadding: getComputedStyle(module).padding,
      moduleWidth: module.getBoundingClientRect().width,
      fixedColor: getComputedStyle(fixed).color,
      fixedPadding: getComputedStyle(fixed).padding,
      dynamicWidth: dynamic.getBoundingClientRect().width,
    };
  });
  assert.deepEqual(result, {
    moduleColor: "rgb(0, 128, 0)", modulePadding: "8px", moduleWidth: 240,
    fixedColor: "rgb(0, 128, 0)", fixedPadding: "8px", dynamicWidth: 100,
  }, `${label}: CSS Module, fixed stylesheet, and dynamic baseline must render correctly`);
}

/** Exercise the application styling against a production server. */
export async function verifyStyleAttributes(browser, origin, label) {
  // Parsing the response with JavaScript disabled distinguishes SSR attributes
  // from later React style updates.
  const firstPaint = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await firstPaint.newPage();
    for (const path of ["/styles", "/styles/next"]) {
      const response = await page.goto(`${origin}${path}`, {waitUntil: "load"});
      assert.equal(response.status(), 200, `${label}: ${path} failed`);
      assert(!response.headers()["content-security-policy"].includes("unsafe-hashes"), `${label}: styling must not require attribute hashes`);
      assert(response.headers()["content-security-policy"].split("; ").includes("style-src-attr 'unsafe-inline'"), `${label}: default policy must allow style attributes`);
      assert.match(await page.locator('[data-style-example="dynamic"]').getAttribute("style"), /width:100px/, `${label}: dynamic React style must be server rendered`);
      await verifyBaseline(page, `${label} first paint ${path}`);
    }
  } finally {
    await firstPaint.close();
  }

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__STYLE_VIOLATIONS__ = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective.startsWith("style-src")) {
        globalThis.__STYLE_VIOLATIONS__.push({directive: event.effectiveDirective, blockedURI: event.blockedURI});
      }
    });
  });
  try {
    const response = await page.goto(`${origin}/styles`, {waitUntil: "networkidle"});
    await page.locator('[data-hydrated="true"]').waitFor();
    await verifyBaseline(page, `${label} hydration`);
    const initialNonce = await page.locator("main").getAttribute("data-request-nonce");
    assert(response.headers()["content-security-policy"].includes(`nonce-${initialNonce}`), `${label}: stylesheet nonce must match the document policy`);
    await page.getByRole("button", {name: "Resize"}).click();
    assert.equal(await page.locator('[data-style-example="dynamic"]').evaluate((element) => element.getBoundingClientRect().width), 173, `${label}: React style update failed`);

    await page.evaluate(() => { globalThis.__STYLE_DOCUMENT__ = true; });
    await page.getByRole("link", {name: "Next style page"}).click();
    await page.waitForURL(`${origin}/styles/next`);
    await page.getByRole("heading", {name: "Next style page"}).waitFor();
    assert(await page.evaluate(() => globalThis.__STYLE_DOCUMENT__ === true), `${label}: Link navigation replaced the document`);
    await verifyBaseline(page, `${label} navigation`);
    const navigationNonce = await page.locator("main").getAttribute("data-request-nonce");
    assert.notEqual(navigationNonce, initialNonce, `${label}: navigation must exercise a fresh request nonce`);
    await page.getByRole("button", {name: "Insert fixed stylesheet"}).click();
    assert.equal(await page.locator(".late-notice").evaluate((element) => getComputedStyle(element).color), "rgb(0, 0, 255)", `${label}: later stylesheet must use the retained document nonce`);
    const lateNonce = await page.locator("style").evaluateAll((elements) => elements.find((element) => element.textContent.includes(".late-notice"))?.nonce);
    assert.equal(lateNonce, initialNonce, `${label}: later stylesheet used a navigation nonce`);

    // Next owns this shadow tree. Verify its accessibility behavior instead of
    // removing the announcer or attributing its styles to application markup.
    const announcer = page.locator('next-route-announcer [role="alert"]');
    await announcer.getByText("Next style page", {exact: true}).waitFor();
    assert.equal(await announcer.getAttribute("aria-live"), "assertive", `${label}: route announcements lost their live region`);
    const announcerStyle = await announcer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {position: style.position, width: style.width, height: style.height, overflow: style.overflow};
    });
    assert.deepEqual(announcerStyle, {position: "absolute", width: "1px", height: "1px", overflow: "hidden"}, `${label}: route announcer is no longer visually hidden`);

    assert.deepEqual(pageErrors, [], `${label}: hydration or navigation raised a browser error`);
    assert.deepEqual(await page.evaluate(() => globalThis.__STYLE_VIOLATIONS__), [], `${label}: application raised unexpected style CSP violations before negative probes`);

    const probes = await page.evaluate(async ({initialNonce, navigationNonce}) => {
      const violations = [];
      document.addEventListener("securitypolicyviolation", (event) => violations.push(event.effectiveDirective));
      for (const [id, nonce] of [["missing", null], ["wrong", "wrong-nonce"], ["navigation", navigationNonce]]) {
        const target = document.createElement("div");
        target.id = `probe-${id}`;
        document.body.append(target);
        const style = document.createElement("style");
        if (nonce) style.nonce = nonce;
        style.textContent = `#probe-${id} { width: 777px; }`;
        document.head.append(style);
      }
      const attribute = document.createElement("div");
      attribute.nonce = initialNonce;
      attribute.setAttribute("style", "width: 777px");
      document.body.append(attribute);
      const serialized = document.createElement("div");
      document.body.append(serialized);
      serialized.innerHTML = `<div nonce="${initialNonce}" style="width: 778px">Injected serialized attribute</div>`;
      const event = document.createElement("button");
      event.setAttribute("onclick", "globalThis.__STYLE_EVENT__ = true");
      document.body.append(event);
      event.click();
      // CSP violation events are queued asynchronously by browsers.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        unauthorizedWidths: ["missing", "wrong", "navigation"].map((id) => getComputedStyle(document.getElementById(`probe-${id}`)).width),
        attributeWidth: getComputedStyle(attribute).width,
        serializedWidth: getComputedStyle(serialized.firstElementChild).width,
        eventExecuted: globalThis.__STYLE_EVENT__ === true,
        violations,
      };
    }, {initialNonce, navigationNonce});
    assert(probes.unauthorizedWidths.every((width) => width !== "777px"), `${label}: unauthorized stylesheet applied`);
    assert.equal(probes.attributeWidth, "777px", `${label}: style attributes should apply`);
    assert.equal(probes.serializedWidth, "778px", `${label}: serialized style attributes should apply`);
    assert.equal(probes.eventExecuted, false, `${label}: inline event handler executed`);
    assert(probes.violations.includes("style-src-elem"), `${label}: stylesheet rejection was not attributed to CSP`);
    assert(!probes.violations.includes("style-src-attr"), `${label}: permitted attributes raised CSP reports`);
    assert(probes.violations.includes("script-src-attr"), `${label}: event rejection was not attributed to CSP`);
  } finally {
    await page.close();
  }
}
