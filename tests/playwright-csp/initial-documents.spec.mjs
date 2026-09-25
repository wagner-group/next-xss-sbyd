import {test as cspTest} from "next-xss-sbyd/playwright";
import {expect} from "@playwright/test";
import {startServer} from "./server.mjs";

const test = cspTest.extend({
  server: [async ({}, use) => {
    const server = await startServer();
    try { await use(server.url); } finally { await server.close(); }
  }, {scope: "worker"}],
});

// Each opening flow must collect the parser's first violation, not merely fail
// because the observer was missing. The outer runner verifies that teardown is
// the only failure and the attachment contains exactly one real CSP violation.
for (const kind of ["popup", "noopener", "frame"]) {
  for (const origin of ["same-origin", "cross-origin"]) {
    for (const mode of ["strict", "initial", "report"]) {
      test(`${mode === "strict" ? "PASS" : "FAIL"} initial document ${kind} ${origin} ${mode}`, async ({page, context, csp, server}) => {
        await page.goto(`${server}/strict`);
        const host = origin === "same-origin" ? server : server.replace("127.0.0.1", "localhost");
        const url = `${host}/${mode}`;
        let target;
        if (kind === "frame") {
          await page.evaluate((url) => {
            const frame = document.createElement("iframe");
            frame.src = url;
            document.body.append(frame);
          }, url);
          await expect.poll(() => page.frames().some((frame) => frame.url() === url)).toBe(true);
          target = page.frames().find((frame) => frame.url() === url);
          await target.waitForLoadState();
        } else {
          const opened = context.waitForEvent("page");
          await page.evaluate(({url, kind}) => window.open(url, "_blank", kind === "noopener" ? "noopener" : ""), {url, kind});
          target = await opened;
          await target.waitForLoadState();
          expect(await target.evaluate(() => window.opener !== null)).toBe(kind === "popup");
          if (mode === "strict") await csp.assertNoncePolicy(target, {scriptSelector: "#authorized"});
        }
        await expect(target.locator("html")).toHaveAttribute("data-ready", "yes");
        if (mode === "report") {
          await expect(target.locator("html")).toHaveAttribute("data-secret-script", "SCRIPT_CONTENT_SECRET");
        } else {
          await expect(target.locator("html")).not.toHaveAttribute("data-secret-script", "SCRIPT_CONTENT_SECRET");
        }
        await csp.flush();
        const records = csp.violations();
        expect(records).toHaveLength(mode === "strict" ? 0 : 1);
        if (mode !== "strict") {
          expect(records[0]).toMatchObject({documentURL: url, effectiveDirective: "script-src-elem", disposition: mode === "report" ? "report" : "enforce", blockedURI: "inline"});
        }
      });
    }
  }
}

for (const mode of ["strict", "redirect", "not-found", "self-navigation"]) {
  test(`PASS initial popup nonce concurrent ${mode}`, async ({page, context, csp, server}) => {
    await page.goto(`${server}/strict`);
    await page.evaluate((url) => {
      for (let index = 0; index < 3; index++) window.open(url, "_blank");
    }, `${server}/${mode}`);
    await expect.poll(() => context.pages().length).toBe(4);
    const popups = context.pages().filter((candidate) => candidate !== page);
    for (const popup of popups) {
      if (mode === "self-navigation") await popup.waitForURL(`${server}/strict`);
      await popup.waitForLoadState();
      // Identical URLs with independent nonces must retain their own responses.
      await csp.assertNoncePolicy(popup, {scriptSelector: "#authorized"});
      await expect(popup.locator("html")).toHaveAttribute("data-ready", "yes");
    }
    const nonces = await Promise.all(popups.map((popup) => popup.locator("#authorized").evaluate((script) => script.nonce)));
    expect(new Set(nonces).size).toBe(3);
    await popups[0].reload();
    await csp.assertNoncePolicy(popups[0], {scriptSelector: "#authorized"});
  });
}
for (const mode of ["missing", "meta"]) {
  test(`FAIL initial popup nonce ${mode}`, async ({page, context, csp, server}) => {
    await page.goto(`${server}/strict`);
    const opened = context.waitForEvent("page");
    await page.evaluate((url) => window.open(url), `${server}/${mode}`);
    const popup = await opened;
    await popup.waitForLoadState();
    await csp.assertNoncePolicy(popup, {scriptSelector: "#authorized"});
  });
}
