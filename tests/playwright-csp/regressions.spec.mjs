import {test as cspTest} from "next-xss-sbyd/playwright";
import {expect} from "@playwright/test";
import {startServer} from "./server.mjs";

const test = cspTest.extend({
  server: [async ({}, use) => {
    const server = await startServer();
    try { await use(server.url); } finally { await server.close(); }
  }, {scope: "worker"}],
});
test.use({cspObservation: {quietMs: 40, timeoutMs: 400}});

test("PASS streaming response exceeds observation timeout", async ({page, csp, server}) => {
  await page.goto(`${server}/streaming`);
  await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
  await expect(page.locator("html")).toHaveAttribute("data-ready", "yes");
});

test("PASS missing expectation can be caught without poisoning teardown", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await expect(csp.expectViolation({frame: page.mainFrame(), effectiveDirective: "script-src-attr",
    disposition: "enforce", blockedURI: "inline", count: 1}, async () => {}, async () => {}))
    .rejects.toThrow("Expected CSP violation count was not received");
  await csp.flush();
  expect(csp.violations()).toEqual([]);
});

test.describe("iframe churn", () => {
  // Require silence across many frame replacements, with the default collection
  // deadline. Short collection deadlines belong in dedicated timeout tests.
  test.use({cspObservation: {quietMs: 500, timeoutMs: 2_000}});
  for (const violation of [false, true]) {
    test(`${violation ? "FAIL" : "PASS"} iframe churn during observation and teardown${violation ? " retains violation" : ""}`, async ({page, csp, server}) => {
      await page.goto(`${server}/strict`);
      await page.evaluate(() => {
        let previous;
        setInterval(() => {
          previous?.remove();
          previous = document.createElement("iframe");
          document.body.append(previous);
        }, 30);
      });
      // Churn deliberately continues through automatic teardown.
      for (let index = 0; index < 4; index++) await csp.flush();
      if (violation) {
        await page.locator("#attack").evaluate(button => {
          button.setAttribute("onclick", "document.documentElement.dataset.attack='executed'");
          button.click();
        });
        await csp.flush();
        expect(csp.violations()).toHaveLength(1);
        expect(csp.violations()[0]).toMatchObject({effectiveDirective: "script-src-attr", disposition: "enforce", blockedURI: "inline"});
        await expect(page.locator("html")).not.toHaveAttribute("data-attack", "executed");
      } else {
        expect(csp.violations()).toEqual([]);
      }
    });
  }
});

for (const scheme of ["data", "blob"]) {
  test(`PASS blocked ${scheme} URI retains scheme`, async ({page, csp, server}) => {
    await page.goto(`${server}/images`);
    // Images avoid strict-dynamic propagation, which can authorize blob scripts
    // created by a trusted execution context in some browsers.
    await csp.expectViolation({frame: page.mainFrame(), effectiveDirective: "img-src", disposition: "enforce",
      blockedURI: `${scheme}:`, count: 1}, async () => {
      await page.evaluate((scheme) => {
        const img = document.createElement("img");
        img.id = "blocked-image";
        img.src = scheme === "data" ? "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" :
          URL.createObjectURL(new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"] , {type: "image/svg+xml"}));
        document.body.append(img);
      }, scheme);
    }, async () => {
      await expect.poll(() => page.locator("#blocked-image").evaluate((img) => img.complete)).toBe(true);
      expect(await page.locator("#blocked-image").evaluate((img) => img.naturalWidth)).toBe(0);
    });
    expect(csp.violations()[0].blockedURI).toBe(`${scheme}:`);
  });
}

test("FAIL sandboxed srcdoc violation retains frame URL", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await page.evaluate(() => {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";
    iframe.srcdoc = "<script>document.body.dataset.attack='executed'</script><p>Frame ready</p>";
    document.body.append(iframe);
  });
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("Frame ready")).toBeVisible();
  await expect(frame.locator("body")).not.toHaveAttribute("data-attack", "executed");
  await csp.flush();
  expect(csp.violations()).toHaveLength(1);
  expect(csp.violations()[0].documentURL).toBe("about:");
});

// Exercise the private parser through real response headers and the public
// assertion. Inert data blocks carry the selected nonce without generating
// unrelated CSP violations, so each error must come from the policy assertion.
for (const mode of ["repeated", "list", "duplicate", "case", "non-ascii", "padded", "base64url", "elem", "sandbox-allows", "default-additional"]) {
  test(`PASS parser real headers ${mode}`, async ({page, csp, server}) => {
    await page.goto(`${server}/${mode}?inert`);
    await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
    expect(csp.violations()).toEqual([]);
  });
}
for (const [mode, message] of [
  ["default-only", "An explicit script-src directive is required"],
  ["elem-no-dynamic", "script-src-elem must contain 'strict-dynamic'"],
  ["elem-mismatch", "Unsupported script-src-elem override: its nonce must match script-src"],
  ["first-duplicate", "script-src must contain exactly one valid, nonempty nonce source"],
  ["report-inert", "Nonce policy assertion requires an enforcing Content-Security-Policy response header"],
]) {
  test(`PASS parser rejects real headers ${mode}`, async ({page, csp, server}) => {
    await page.goto(`${server}/${mode}?inert`);
    await expect(csp.assertNoncePolicy(page, {scriptSelector: "#authorized"})).rejects.toThrow(message);
    expect(csp.violations()).toEqual([]);
  });
}

// Chromium/WebKit do not initialize an observer in a no-scripts sandbox;
// Firefox can initialize and rejects its response policy explicitly instead.
test("FAIL parser sandbox without scripts", async ({page, csp, server}) => {
  await page.goto(`${server}/sandbox-blocks?inert`);
  await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
});

test("PASS mistaken Page expectation has clear diagnostic", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await expect(csp.expectViolation({frame: page, effectiveDirective: "script-src-attr", disposition: "enforce",
    blockedURI: "inline", count: 1}, async () => {}, async () => {}))
    .rejects.toThrow("CSP expectation requires a Frame in the observed context");
});

test("FAIL blocked blob script retains scheme", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(["document.body.dataset.attack='executed'"], {type: "text/javascript"}));
    const iframe = document.createElement("iframe");
    iframe.srcdoc = `<script src="${url}"></script><p>Frame ready</p>`;
    document.body.append(iframe);
  });
  await expect(page.frameLocator("iframe").getByText("Frame ready")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("body")).not.toHaveAttribute("data-attack", "executed");
  await csp.flush();
  expect(csp.violations()).toHaveLength(1);
  expect(csp.violations()[0]).toMatchObject({effectiveDirective: "script-src-elem", blockedURI: "blob:"});
});

// Chromium waits for this streaming document's DOMContentLoaded; Firefox and
// WebKit associate earlier. The runner requires the precise timeout only in
// Chromium and successful nonce validation in the other two browsers.
test.describe("bounded response association", () => {
  test.use({cspObservation: {quietMs: 40, timeoutMs: 400, associationTimeoutMs: 100}});
  test("streaming response explicit association deadline", async ({page, csp, server}) => {
    await page.goto(`${server}/streaming`);
    await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
  });
});
// Missing transport dispositions and sequence gaps require forged binding
// messages; native browser violations supply these fields. They are not mocked.
