import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";

for (const environment of ["development", "production"]) {
  test(`middleware rejects unsafe caller sources and preserves trusted defaults in ${environment}`, () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import {NextRequest} from "next/server.js";
      import {createXssSbydHandler} from "next-xss-sbyd/csp";

      const request = new NextRequest("https://example.test/page");
      const options = ["scriptSrc", "styleSrc", "connectSrc", "imgSrc", "fontSrc", "mediaSrc", "frameSrc", "formAction"];
      for (const option of options) {
        for (const source of ["'unsafe-inline'", "'unsafe-eval'", "'UnSaFe-InLiNe'", "'UNSAFE-EVAL'", "'unsafe-hashes'", "'UnSaFe-HaShEs'"]) {
          await assert.rejects(createXssSbydHandler({[option]: [source]})(request, {}), (error) => {
            assert.ok(error instanceof TypeError);
            assert.ok(error.message.includes(option), error.message);
            assert.ok(error.message.includes(source), error.message);
            assert.match(error.message, /remove/i);
            return true;
          });
        }
        for (const source of ["https://ok.test https://evil.test", "https://ok.test;script-src *", "https://ok.test,https://evil.test", "https://ok.test\\n", "https://ok.test\\u0000", "https://ok.test\\u007f"]) {
          await assert.rejects(createXssSbydHandler({[option]: [source]})(request, {}), TypeError);
        }
        const response = await createXssSbydHandler({[option]: ["https://trusted.test"]})(request, {});
        assert.ok(response.headers.get("content-security-policy").includes("https://trusted.test"));
      }
      const response = await createXssSbydHandler()(request, {});
      const policy = response.headers.get("content-security-policy");
      assert.equal(policy.includes("'unsafe-eval'"), process.env.NODE_ENV === "development");
      assert.deepEqual(policy.split("; ").filter(value => value.includes("'unsafe-inline'")), ["style-src 'self' 'unsafe-inline'", "style-src-attr 'unsafe-inline'"]);
      assert.ok(policy.split("; ").includes("style-src-attr 'unsafe-inline'"));
      assert.equal(policy.includes("unsafe-hashes"), false);
      const nonce = response.headers.get("x-middleware-request-x-nonce");
      assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
      assert.ok(policy.includes("'nonce-" + nonce + "'"));
      assert.equal(response.headers.get("x-middleware-request-content-security-policy"), policy);
      for (const settings of [{}, {styleSrc: undefined}, {styleSrc: []}, {styleSrc: ["https://styles.test"]}]) {
        const configuredResponse = await createXssSbydHandler(settings)(request, {});
        const configuredPolicy = configuredResponse.headers.get("content-security-policy");
        assert.equal(configuredPolicy.split("; ").includes("style-src-attr 'unsafe-inline'"), true);
        const sources = settings.styleSrc?.length ? " " + settings.styleSrc.join(" ") : "";
        const styleNonce = configuredResponse.headers.get("x-middleware-request-x-nonce");
        assert.ok(configuredPolicy.split("; ").includes("style-src 'self' 'unsafe-inline'" + sources));
        assert.ok(configuredPolicy.split("; ").includes("style-src-elem 'self' 'nonce-" + styleNonce + "'" + sources));
      }
    `], {encoding: "utf8", env: {...process.env, NODE_ENV: environment}});
    assert.equal(result.status, 0, result.stderr);
  });
}

test("CSP suggestion CLI distinguishes style attributes from stylesheet elements", () => {
  const reports = ["style-src-attr", "style-src-elem", "style-src"].map((violatedDirective) => ({
    violatedDirective,
    blockedOrigin: "inline",
    sample: "color: green",
  }));
  const result = spawnSync(process.execPath, ["packages/next-xss-sbyd/dist/csp-suggest.js"], {
    input: JSON.stringify(reports),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  const warnings = result.stderr.trim().split("\n");
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /style-src-attr.*already allows.*additional.*policy.*cached response/i);
  assert.match(warnings[1], /style-src-elem.*stylesheet.*nonce/);
  assert.match(warnings[2], /style-src.*nonce.*stylesheet/);
  for (const warning of warnings.slice(1)) assert.match(warning, /do not add 'unsafe-inline'/);
});

test("configured stylesheet origins allow style attributes in installed browsers", async (t) => {
  const {access} = await import("node:fs/promises");
  const {createServer} = await import("node:http");
  const {chromium, firefox, webkit} = await import("playwright-core");
  const {createContentSecurityPolicy} = await import("next-xss-sbyd/csp");
  const nonce = "abcdefghijklmnopqrstuv";
  const policies = [{}, {styleSrc: []}, {styleSrc: ["https://styles.test"]}]
    .flatMap(options => {
      const policy = createContentSecurityPolicy(nonce, options);
      // Exercise the emitted legacy fallback by serving it without the granular
      // directives. This tests fallback semantics, not an old browser binary.
      return [policy, policy.split("; ").filter(value => !/^style-src-(attr|elem) /.test(value)).join("; ")];
    });
  const server = createServer((request, response) => {
    const policy = policies[Number(request.url.slice(1))] ?? policies[0];
    response.writeHead(200, {"content-type": "text/html", "content-security-policy": policy});
    response.end(`<style nonce="${nonce}">#authorized {width: 123px}</style>
      <style>#missing {width: 456px}</style><style nonce="wrong">#wrong {width: 456px}</style>
      <div id="authorized">authorized</div><div id="missing">missing</div><div id="wrong">wrong</div>
      <div id="probe" style="width:777px">probe</div>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  let checked = 0;
  for (const [engine, executablePath] of [
    [chromium, process.env.CHROME_PATH ?? (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome")],
    [firefox, firefox.executablePath()],
    [webkit, webkit.executablePath()],
  ]) {
    try { await access(executablePath); }
    catch { t.diagnostic(`${engine.name()} unavailable: ${executablePath}`); continue; }
    const browser = await engine.launch({headless: true, executablePath});
    try {
      const page = await browser.newPage();
      for (let index = 0; index < policies.length; index++) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${index}`);
        assert.equal(await page.locator("#probe").evaluate(node => getComputedStyle(node).width), "777px");
        assert.equal(await page.locator("#authorized").evaluate(node => getComputedStyle(node).width), "123px");
        for (const id of ["missing", "wrong"]) {
          const width = await page.locator(`#${id}`).evaluate(node => getComputedStyle(node).width);
          assert.equal(width === "456px", index % 2 === 1, `${engine.name()}: policy ${index}, ${id} nonce`);
        }
      }
      t.diagnostic(`${engine.name()} ${browser.version()}: default, empty and CDN styleSrc allowed attributes and enforced modern stylesheet nonces with a permissive legacy fallback`);
      checked++;
    } finally { await browser.close(); }
  }
  if (checked === 0) t.skip("No browser installed; set CHROME_PATH for the CSP browser regression");
});
