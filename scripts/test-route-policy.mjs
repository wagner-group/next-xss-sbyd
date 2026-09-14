import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";

/** Checks wrapper enforcement and Next's response transformations over real HTTP. */
export async function verifyRoutePolicy(browser, origin, label) {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, {"content-type": "text/html"});
    response.end("<b>upstream</b>");
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const source = `http://127.0.0.1:${upstream.address().port}`;
  try {
    for (const mode of ["blob", "missing", "svg", "mutated", "forward"]) {
      const response = await fetch(`${origin}/api/route-policy?${new URLSearchParams({mode, upstream: source})}`);
      assert.equal(response.status, 500, `${label}: ${mode} reached client`);
      assert(!(await response.text()).includes("__ROUTE_XSS__"));
    }
    for (const mode of ["safe", "next", "cookie", "clone", "rewrap"]) {
      const response = await fetch(`${origin}/api/route-policy?mode=${mode}`);
      assert.equal(response.status, 200, `${label}: ${mode}`);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await response.text(), "&lt;script&gt;globalThis.__ROUTE_XSS__=true&lt;/script&gt;");
      if (mode === "cookie") assert(response.headers.get("set-cookie")?.includes("safe-route=yes"));
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${origin}/api/route-policy?${new URLSearchParams({mode: "cached-fetch", upstream: source})}`);
      assert.equal(response.status, 200, `${label}: cached fetch`);
      assert.equal((await response.json()).text, "<b>upstream</b>");
    }
    const converter = await fetch(`${origin}/api/route-policy?mode=converter`);
    assert.equal(converter.status, 200);
    assert.equal((await converter.json()).text, "<script>globalThis.__ROUTE_XSS__=true</script>");
    const staticResponse = await fetch(`${origin}/api/route-policy-static`);
    assert.equal(staticResponse.status, 200);
    assert.equal(await staticResponse.text(), "&lt;static-safe&gt;");
    const edge = await fetch(`${origin}/api/route-policy-edge`);
    assert.equal(edge.status, 200);
    assert.equal((await edge.json()).wrapped, true);
    const edgeUnsafe = await fetch(`${origin}/api/route-policy-edge?unsafe=1`);
    assert.equal(edgeUnsafe.status, 500);
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const message = await page.evaluate(() => new Promise((resolve, reject) => {
        const source = new EventSource("/api/route-policy?mode=sse");
        const timer = setTimeout(() => { source.close(); reject(new Error("SSE timed out")); }, 10000);
        source.onmessage = (event) => { clearTimeout(timer); source.close(); resolve(event.data); };
        source.onerror = () => { clearTimeout(timer); source.close(); reject(new Error("SSE failed")); };
      }));
      assert.equal(message, "ready");
    } finally { await page.close(); }
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
}
