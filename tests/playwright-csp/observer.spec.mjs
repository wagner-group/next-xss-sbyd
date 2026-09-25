import {test as cspTest} from "next-xss-sbyd/playwright";
import {expect, mergeTests, test as base} from "@playwright/test";
import {startServer} from "./server.mjs";

const serverTest = base.extend({
  server: [async ({}, use) => { const server = await startServer(); try { await use(server.url); } finally { await server.close(); } }, {scope: "worker"}],
});
const test = mergeTests(cspTest, serverTest);
test.use({cspObservation: {quietMs: 40, timeoutMs: 800}});

async function attack(frame) {
  await frame.evaluate(() => {
    document.querySelector("#attack")?.remove();
    const button = document.createElement("button");
    button.id = "attack";
    button.textContent = "Attack";
    button.setAttribute("onclick", "document.documentElement.dataset.attack='ATTACK_CONTENT_SECRET'");
    document.body.append(button);
  });
  await frame.locator("#attack").click();
}
function expected(frame, extra = {}) {
  return {frame, effectiveDirective: "script-src-attr", disposition: "enforce", blockedURI: "inline", count: 1, ...extra};
}
async function blocked(page) { await expect(page.locator("html")).not.toHaveAttribute("data-attack", "ATTACK_CONTENT_SECRET"); }

for (const mode of ["strict", "elem", "duplicate", "repeated", "list", "not-found"]) {
  test(`PASS policy ${mode}`, async ({page, csp, server}) => {
    await page.goto(`${server}/${mode}`);
    await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
    await expect(page.locator("html")).toHaveAttribute("data-ready", "yes");
  });
}
for (const mode of ["missing", "meta", "report", "mismatch", "unsafe", "attr", "first-duplicate", "empty-nonce", "two-nonces", "eval", "wasm", "inline", "second-blocks"]) {
  test(`FAIL policy ${mode}`, async ({page, csp, server}) => {
    await page.goto(`${server}/${mode}`);
    await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
  });
}
for (const selector of [".absent", "h1"]) {
  test(`FAIL selector ${selector}`, async ({page, csp, server}) => {
    await page.goto(`${server}/strict`);
    await csp.assertNoncePolicy(page, {scriptSelector: selector});
  });
}
test("FAIL automatic initial violation without csp fixture", async ({page, server}) => {
  await page.goto(`${server}/initial?QUERY_SECRET=yes#FRAGMENT_SECRET`);
  await expect(page.getByRole("heading")).toHaveText("Ready");
});
test("FAIL automatic report-only violation", async ({page, server}) => {
  await page.goto(`${server}/report`);
  await expect(page.locator("html")).toHaveAttribute("data-secret-script", "SCRIPT_CONTENT_SECRET");
});
test("PASS expected blocked attack and frozen snapshot", async ({page, csp, server}) => {
  await page.goto(`${server}/strict?QUERY_SECRET=yes#FRAGMENT_SECRET`);
  await csp.expectViolation(expected(page.mainFrame()), () => attack(page), () => blocked(page));
  const records = csp.violations();
  expect(Object.isFrozen(records)).toBe(true);
  expect(Object.isFrozen(records[0])).toBe(true);
  expect(records).toHaveLength(1);
  expect(records[0].sequence).toBe(1);
  expect(records[0].documentURL).toBe(`${server}/strict`);
});
for (const kind of ["missing", "extra", "disposition", "source", "behavior", "action", "unrelated", "navigate"]) {
  test(`FAIL expected ${kind}`, async ({page, csp, server}) => {
    await page.goto(`${server}/strict`);
    await csp.expectViolation(expected(page.mainFrame(), kind === "disposition" ? {disposition: "report"} : kind === "source" ? {sourceURL: `${server}/wrong`} : {}), async () => {
      if (kind === "missing") return;
      if (kind === "action") throw new Error("Intentional action failure");
      await attack(page);
      if (kind === "extra") await attack(page);
      if (kind === "unrelated") await page.evaluate(() => { const object = document.createElement("object"); object.data = "/blocked-object"; document.body.append(object); });
      if (kind === "navigate") await page.reload();
    }, async () => { if (kind === "behavior") expect(false).toBe(true); else await blocked(page); });
  });
}
test("FAIL retained through navigation and page close", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await attack(page);
  await csp.flush();
  const documentId = csp.violations()[0].documentId;
  await page.reload();
  await attack(page);
  await csp.flush();
  expect(csp.violations()[1].documentId).not.toBe(documentId);
  await page.close();
  expect(csp.violations()).toHaveLength(2);
});
test("PASS fresh nonce reload and same-document navigation", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  await page.evaluate(() => history.pushState({}, "", "/client-route"));
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  await page.goto(`${server}/strict`);
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  await page.reload();
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
});
test("FAIL reused nonce on same URL reload", async ({page, csp, server}) => {
  await page.goto(`${server}/reuse`);
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  await page.reload();
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
});
test("FAIL setContent response evidence", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  const nonce = await page.locator("#authorized").evaluate((script) => script.nonce);
  await page.setContent(`<script id="authorized" nonce="${nonce}">document.documentElement.dataset.ready='yes'</script>`);
  await csp.assertNoncePolicy(page, {scriptSelector: "script"});
});
test("PASS popup and frame identities", async ({page, context, csp, server}) => {
  await page.goto(`${server}/strict`);
  await page.evaluate((url) => {
    for (const src of [url.replace("127.0.0.1", "localhost"), url.replace("127.0.0.1", "127.0.0.2")]) {
      const frame = document.createElement("iframe"); frame.src = `${src}/strict`; document.body.append(frame);
    }
  }, server);
  await expect.poll(() => page.frames().filter((frame) => frame.url().endsWith("/strict")).length).toBe(3);
  for (const frame of page.frames().filter((frame) => frame !== page.mainFrame())) {
    await frame.waitForLoadState();
    await csp.expectViolation(expected(frame), () => attack(frame), async () => { expect(await frame.evaluate(() => document.documentElement.dataset.attack)).toBeUndefined(); });
  }
  const popupPromise = context.waitForEvent("page");
  await page.evaluate((url) => window.open(`${url}/strict`, "_blank", "noopener"), server);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await csp.expectViolation(expected(popup.mainFrame()), () => attack(popup), () => blocked(popup));
  expect(new Set(csp.violations().map((record) => record.frameId)).size).toBe(3);
  expect(new Set(csp.violations().map((record) => record.pageId)).size).toBe(2);
  await popup.goto(`${server}/strict`);
  await csp.assertNoncePolicy(popup, {scriptSelector: "#authorized"});
});
test("FAIL earlier records stay unexpected", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await attack(page);
  await csp.flush();
  await csp.expectViolation(expected(page.mainFrame()), () => attack(page), () => blocked(page));
});
test("FAIL later identical record stays unexpected", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await csp.expectViolation(expected(page.mainFrame()), () => attack(page), () => blocked(page));
  await attack(page);
});
test("FAIL teardown also records violations after body failure", async ({page, server}) => {
  await page.goto(`${server}/initial`);
  expect(false).toBe(true);
});
test.describe("bypass", () => {
  test.use({bypassCSP: true});
  test("FAIL bypass configuration", async ({page}) => { await page.goto("about:blank"); });
});
for (const quietMs of [0, -1, 1.5, 800]) {
  test.describe(`invalid ${quietMs}`, () => {
    test.use({cspObservation: {quietMs, timeoutMs: 800}});
    test(`FAIL invalid quiet ${quietMs}`, async ({page}) => { await page.goto("about:blank"); });
  });
}
const precreated = test.extend({
  context: async ({browser}, use) => { const context = await browser.newContext(); await context.newPage(); try { await use(context); } finally { await context.close(); } },
});
precreated("FAIL precreated context", async ({page}) => { await page.goto("about:blank"); });
test("FAIL continuous violations bounded flush", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  const timer = await page.evaluate(() => setInterval(() => {
    const button = document.createElement("button");
    button.setAttribute("onclick", "document.documentElement.dataset.attack='yes'");
    document.body.append(button); button.click(); button.remove();
  }, 10));
  try { await csp.flush(); } finally { await page.evaluate((id) => clearInterval(id), timer); }
});
test("FAIL expectation wrong frame", async ({page, context, csp, server}) => {
  await page.goto(`${server}/strict`);
  const other = await context.newPage();
  await other.goto(`${server}/strict`);
  await csp.expectViolation(expected(page.mainFrame()), () => attack(other), () => blocked(other));
});
test("FAIL foreign context assertion", async ({browser, csp, server}) => {
  const foreign = await browser.newContext();
  try {
    const page = await foreign.newPage();
    await page.goto(`${server}/strict`);
    await csp.assertNoncePolicy(page, {scriptSelector: "script"});
  } finally { await foreign.close(); }
});
test("FAIL nested expectation", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await csp.expectViolation(expected(page.mainFrame()), async () => {
    await csp.expectViolation(expected(page.mainFrame()), () => attack(page), () => blocked(page));
  }, () => blocked(page));
});
for (const count of [0, -1, 1.5]) {
  test(`FAIL invalid expectation count ${count}`, async ({page, csp, server}) => {
    await page.goto(`${server}/strict`);
    await csp.expectViolation(expected(page.mainFrame(), {count}), () => attack(page), () => blocked(page));
  });
}
test("FAIL missing initialization in live document", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  // Deliberately remove the installed observer to exercise failed acknowledgement.
  // Real events and transport are used throughout; no synthetic CSP event is injected.
  await page.evaluate(() => {
    for (const key of Object.keys(globalThis)) if (key.startsWith("__csp_observer_")) delete globalThis[key];
  });
  await csp.flush();
});
test("PASS exact source matching redacts query and fragment", async ({page, csp, server, browserName}) => {
  await page.goto(`${server}/strict?QUERY_SECRET=yes#FRAGMENT_SECRET`);
  await csp.expectViolation(expected(page.mainFrame(), {sourceURL: browserName !== "chromium" ? "" : `${server}/strict?OTHER_SECRET=yes#OTHER_FRAGMENT`}), () => attack(page), () => blocked(page));
});
test("PASS identical native events are separate records", async ({page, csp, server}) => {
  await page.goto(`${server}/strict`);
  await csp.expectViolation(expected(page.mainFrame(), {count: 2}), async () => { await attack(page); await attack(page); }, () => blocked(page));
  expect(csp.violations().map((record) => record.sequence)).toEqual([1, 2]);
  expect(csp.violations()[0].documentId).toBe(csp.violations()[1].documentId);
});

test("FAIL download response cannot replace current policy evidence", async ({page, csp, server}) => {
  await page.goto(`${server}/missing`);
  const nonce = await page.locator("#authorized").evaluate((script) => script.nonce);
  await page.evaluate((href) => { const link = document.createElement("a"); link.href = href; link.textContent = "Download"; document.body.append(link); }, `${server}/download?nonce=${encodeURIComponent(nonce)}`);
  const download = page.waitForEvent("download");
  await page.getByRole("link", {name: "Download"}).click();
  await download;
  await page.evaluate(() => { location.hash = "after-download"; });
  await csp.assertNoncePolicy(page, {scriptSelector: "#authorized"});
});

test("FAIL initial violations in frames and popup retain identities", async ({page, context, csp, server}) => {
  await page.goto(`${server}/strict`);
  await page.evaluate((url) => {
    for (const src of [url, url.replace("127.0.0.1", "localhost")]) {
      const frame = document.createElement("iframe"); frame.src = `${src}/initial`; document.body.append(frame);
    }
  }, server);
  await expect.poll(() => page.frames().filter((frame) => frame.url().endsWith("/initial")).length).toBe(2);
  for (const frame of page.frames().filter((frame) => frame !== page.mainFrame())) await frame.waitForLoadState();
  const popupPromise = context.waitForEvent("page");
  await page.evaluate((url) => window.open(`${url}/initial`), server);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  // All three real initial violations must survive the opening flows.
  await csp.flush();
  expect(csp.violations()).toHaveLength(3);
  expect(new Set(csp.violations().map((record) => record.frameId)).size).toBe(3);
  expect(new Set(csp.violations().map((record) => record.pageId)).size).toBe(2);
});
test.describe("retry isolation", () => {
  test.describe.configure({retries: 1});
  test("PASS retry starts with independent observation records", async ({page, csp, server}, testInfo) => {
    expect(csp.violations()).toHaveLength(0);
    await page.goto(`${server}/strict`);
    if (testInfo.retry === 0) {
      await attack(page);
      await csp.flush();
    } else {
      await csp.expectViolation(expected(page.mainFrame()), () => attack(page), () => blocked(page));
      expect(csp.violations().map((record) => record.sequence)).toEqual([1]);
    }
  });
});
test("FAIL context closed before observation teardown", async ({page, context, server}) => {
  await page.goto(`${server}/strict`);
  await context.close();
});
// The transport retry and sequence-gap branches require deliberately forged
// binding messages, rather than real browser behavior; these tests do not mock
// the transport or fabricate SecurityPolicyViolationEvents. Real duplicate
// native events, document replacement, missing initialization, and timeout
// failures are exercised above.

test("FAIL initial violation in noopener popup", async ({page, context, csp, server}) => {
  await page.goto(`${server}/strict`);
  const popupPromise = context.waitForEvent("page");
  await page.evaluate((url) => window.open(`${url}/initial`, "_blank", "noopener"), server);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await csp.flush();
  expect(csp.violations()).toHaveLength(1);
  expect(csp.violations()[0].documentURL).toBe(`${server}/initial`);
});
