import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {chromium, firefox, webkit} from "playwright-core";
import {passiveResponse, withSafeApiRoute, withSafeRouteHandler} from "next-xss-sbyd/enforce";
import {passiveTypes} from "../tests/passive-content-cases.mjs";
import {chromePath} from "./test-native-pdf.mjs";

const executed = new Set();
let origin;
const guarded = withSafeApiRoute(function serve(request, response) {
  const url = new URL(request.url, origin);
  response.setHeader("content-type", url.searchParams.get("type"));
  response.end(payload(url.searchParams.get("id"), url.searchParams.get("type")));
});

/** HTML that both changes the document and reports execution over real HTTP. */
function payload(id, type = "") {
  const html = id.endsWith("-html") ? `<!doctype html><script>globalThis.__passiveXss = true; fetch('/executed?id=${id}');</script>` : `<html xmlns="http://www.w3.org/1999/xhtml"><script>globalThis.__passiveXss = true; fetch('/executed?id=${id}');</script></html>`;
  if (type === "multipart/form-data; boundary=passive-test") {
    return `--passive-test\r\nContent-Disposition: form-data; name="file"; filename="attack.html"\r\nContent-Type: text/html\r\n\r\n${html}\r\n--passive-test--\r\n`;
  }
  return html;
}

const server = createServer(async function serve(request, response) {
  const url = new URL(request.url, origin);
  if (url.pathname === "/executed") {
    executed.add(url.searchParams.get("id"));
    response.end();
  } else if (url.pathname === "/control") {
    response.setHeader("content-type", "text/html");
    response.end(payload("control"));
  } else if (url.pathname === "/node") {
    guarded(request, response);
  } else if (url.pathname === "/route") {
    const outgoing = await withSafeRouteHandler(() => new Response(new TextEncoder().encode(payload(url.searchParams.get("id"), url.searchParams.get("type"))), {headers:{"content-type":url.searchParams.get("type")}}))();
    response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
    response.end(Buffer.from(await outgoing.arrayBuffer()));
  } else if (url.pathname === "/proxy") {
    const outgoing = passiveResponse(await fetch(origin + "/upstream" + url.search));
    response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
    response.end(Buffer.from(await outgoing.arrayBuffer()));
  } else if (url.pathname === "/upstream") {
    response.setHeader("content-type", url.searchParams.get("type"));
    response.end(payload(url.searchParams.get("id"), url.searchParams.get("type")));
  } else response.writeHead(404).end();
});

/** Checks direct navigation with and without the proxy's forced nosniff header. */
async function verify(browser, name) {
  const context = await browser.newContext({acceptDownloads: true});
  try {
    const control = await context.newPage();
    await control.goto(origin + "/control");
    assert.equal(await control.evaluate(() => globalThis.__passiveXss), true);
    await control.waitForFunction(() => document.readyState === "complete");
    await control.close();
    for (const [index, type] of [...passiveTypes, ...passiveTypes.map(type => `${type}; charset=utf-8`), "multipart/form-data; boundary=passive-test"].entries()) {
      for (const [mode, syntax] of ["node", "proxy", "route"].flatMap(mode => ["html", "xhtml"].map(syntax => [mode, syntax]))) {
        const id = `${name}-${mode}-${index}-${syntax}`;
        const page = await context.newPage();
        let download;
        page.on("download", value => { download = value; });
        const url = `${origin}/${mode}?type=${encodeURIComponent(type)}&id=${id}`;
        // Check actual bytes and status independently of native download/viewer behavior.
        const result = await fetch(url);
        assert.equal(result.status, 200);
        assert.equal(await result.text(), payload(id, type));
        if (mode === "proxy" || mode === "route") assert.equal(result.headers.get("x-content-type-options"), "nosniff");
        try {
          await page.goto(url, {waitUntil: "load", timeout: 10000});
        } catch (error) {
          // Unsupported types download. An arbitrary navigation/network failure
          // must not count as successful protection.
          if (!download) download = await page.waitForEvent("download", {timeout: 1000}).catch(() => null);
          assert.ok(download, `${name} ${type}: unexpected navigation failure: ${error.message}`);
        }
        if (download) assert.equal(await download.failure(), null);
        else assert.notEqual(await page.evaluate(() => globalThis.__passiveXss), true, `${name} ${mode} ${type}`);
        assert.equal(executed.has(id), false, `${name} ${mode} ${type}: HTML executed`);
        await page.close();
      }
    }
    console.log(`${name} ${browser.version()}: ${passiveTypes.length} types plus HTML-bearing form data, direct navigation, Node, proxy and route passed`);
  } finally { await context.close(); }
}

server.listen(0, "127.0.0.1");
await once(server, "listening");
origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const name of (process.env.PASSIVE_BROWSERS ?? "chromium,firefox,webkit").split(",")) {
    const engine = {chromium, firefox, webkit}[name];
    assert.ok(engine, `Unknown browser ${name}`);
    const browser = await engine.launch({headless: true, ...(name === "chromium" ? {executablePath: await chromePath()} : {})});
    try { await verify(browser, name); } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
