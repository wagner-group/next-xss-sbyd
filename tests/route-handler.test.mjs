import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {once} from "node:events";
import {htmlEscape, SafeResponse, SafeNextResponse} from "next-xss-sbyd";
import {withSafeRouteHandler} from "next-xss-sbyd/enforce";

const bytes = new TextEncoder().encode("<script>unsafe()</script>");
for (const type of [null, "text/html", "image/svg+xml", "application/xhtml+xml", "application/pdf", "application/xml", "text/plain, text/html", "application/json; charset"]) {
  test(`route rejects final binary type ${type}`, async () => {
    const handler = withSafeRouteHandler(() => new Response(new Blob([bytes], type ? {type} : {})));
    await assert.rejects(handler(), /Content-Type/);
  });
}
for (const Class of [SafeResponse, SafeNextResponse]) {
  test(`${Class.name} survives clone, repeated clone and same-stream header copies`, async () => {
    const safe = new Class(htmlEscape("<safe>"));
    const copy = safe.clone().clone();
    const rewrapped = new Response(copy.body, {headers: copy.headers});
    const response = await withSafeRouteHandler(() => rewrapped)();
    assert.equal(await response.text(), "&lt;safe&gt;");
    assert.equal(await safe.text(), "&lt;safe&gt;");
    rewrapped.headers.set("content-type", "text/plain");
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  });
  test(`${Class.name} mutated HTML security headers rejected`, async () => {
    const response = new Class(htmlEscape("safe"));
    response.headers.set("content-type", "text/plain");
    await assert.rejects(withSafeRouteHandler(() => response)(), /Safe HTML/);
  });
}
test("real HTTP upstream forwarding checks effective headers without blocking internal HTML reads", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {"Content-Type": "text/html"});
    response.end(bytes);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(withSafeRouteHandler(() => fetch(url))(), /Content-Type/);
    const accepted = await withSafeRouteHandler(async () => Response.json({text: await (await fetch(url)).text()}))();
    assert.equal((await accepted.json()).text, new TextDecoder().decode(bytes));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("empty responses and redirects get nosniff; arguments and handler errors propagate", async () => {
  for (const original of [new Response(null, {status: 204}), Response.redirect("https://example.test")]) {
    const output = await withSafeRouteHandler((input) => input)(original);
    assert.equal(output.status, original.status);
    assert.equal(output.headers.get("x-content-type-options"), "nosniff");
  }
  await assert.rejects(withSafeRouteHandler(() => ({}))(), /Response/);
  await assert.rejects(withSafeRouteHandler(() => { throw new Error("handler failed"); })(), /handler failed/);
});
test("safe prototype impersonation does not authenticate raw HTML", async () => {
  const response = new Response(bytes, {headers: {"content-type": "text/html"}});
  Object.setPrototypeOf(response, SafeResponse.prototype);
  await assert.rejects(withSafeRouteHandler(() => response)(), /Content-Type/);
});
for (const type of ["text/event-stream", "application/x-ndjson", "multipart/form-data; boundary=abc", "application/x-www-form-urlencoded", "text/csv", "text/markdown", "text/vtt", "application/zip", "application/gzip", "application/wasm", "image/png", "audio/mpeg", "video/mp4", "font/woff2", "application/vnd.ms-excel", "application/problem+json", 'Text/Plain; charset="utf-8"']) {
  test(`passive route preserves bytes and type ${type}`, async () => {
    const response = await withSafeRouteHandler(() => new Response(bytes, {status: 201, headers: {"content-type": type, "x-content-type-options": "off"}}))();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("content-type"), type);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });
}
test("header mutations after construction and missing security headers cannot evade validation", async () => {
  const raw = new Response(bytes, {headers: {"content-type": "application/json"}});
  raw.headers.set("content-type", "text/html");
  await assert.rejects(withSafeRouteHandler(() => raw)(), /Content-Type/);
  const safe = new SafeResponse(htmlEscape("safe"));
  safe.headers.delete("x-content-type-options");
  await assert.rejects(withSafeRouteHandler(() => safe)(), /Safe HTML/);
});
test("converter idiom and ordinary unsafe clones are not authenticated", async () => {
  const original = new Response(bytes, {headers: {"content-type": "text/html"}});
  const clone = original.clone();
  assert.equal(await new Response(original.body).text(), new TextDecoder().decode(bytes));
  await assert.rejects(withSafeRouteHandler(() => clone)(), /Content-Type/);
});
test("objects with a Response prototype are rejected using the native brand", async () => {
  await assert.rejects(withSafeRouteHandler(() => Object.create(Response.prototype))(), /native Response/);
});
test("shadowed body getters cannot authenticate different native bytes or clone branches", async () => {
  const safe = new SafeResponse(htmlEscape("safe"));
  const unsafe = new Response(bytes, {headers: {"content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff"}});
  Object.defineProperty(unsafe, "body", {get: () => safe.body});
  await assert.rejects(withSafeRouteHandler(() => unsafe)(), /Content-Type/);
  await assert.rejects(withSafeRouteHandler(() => unsafe.clone())(), /Content-Type/);
});
test("response headers are copied once before validation", async () => {
  const response = new Response(bytes, {headers: {"content-type": "text/plain"}});
  let reads = 0;
  Object.defineProperty(response, "headers", {get: () => new Headers({"content-type": ++reads === 1 ? "text/plain" : "text/html"})});
  const checked = await withSafeRouteHandler(() => response)();
  assert.equal(checked.headers.get("content-type"), "text/plain");
  assert.equal(reads, 1);
});
for (const body of [bytes.buffer, new DataView(bytes.buffer), Buffer.from(bytes), new Blob([bytes]), new URLSearchParams({value: "<unsafe>"}), (() => { const form = new FormData(); form.set("value", "<unsafe>"); return form; })()]) {
  test(`native ${body.constructor.name} body uses effective final Content-Type`, async () => {
    const response = new Response(body, {headers: {"content-type": "application/octet-stream"}});
    const expected = await response.clone().arrayBuffer();
    const checked = await withSafeRouteHandler(() => response)();
    assert.deepEqual(await checked.arrayBuffer(), expected);
  });
}
test("null HTML response does not require authentication and still gets nosniff", async () => {
  const checked = await withSafeRouteHandler(() => new Response(null, {status: 304, headers: {"content-type": "text/html"}}))();
  assert.equal(checked.status, 304);
  assert.equal(checked.headers.get("x-content-type-options"), "nosniff");
});
test("route labels appear in policy errors and empty safe HTML remains authenticated", async () => {
  await assert.rejects(withSafeRouteHandler(() => new Response(bytes), "app/api/file/route.ts GET")(), /app\/api\/file\/route.ts GET/);
  const response = new SafeResponse(htmlEscape(""));
  response.headers.delete("content-type");
  await assert.rejects(withSafeRouteHandler(() => response)(), /Safe HTML.*no Content-Type/);
});
// Missing native Response accessors would require replacing the platform with a
// test double. Those environment-corruption checks are not exercised here.

test("authenticated React streaming HTML survives the wrapper without buffering", async () => {
  const {safeRenderToReadableStream} = await import("next-xss-sbyd/render");
  const {createElement} = await import("react");
  const stream = await safeRenderToReadableStream(createElement("p", null, "<safe-stream>"));
  const original = new SafeResponse(stream);
  const checked = await withSafeRouteHandler(() => original)();
  assert.equal(checked.body, original.body);
  assert.equal(checked.bodyUsed, false);
  assert.equal(await checked.text(), "<p>&lt;safe-stream&gt;</p>");
});
test("native null-body and failed clones preserve platform semantics", async () => {
  const empty = new Response(null, {status: 204});
  assert.equal(empty.clone().status, 204);
  const safe = new SafeResponse(htmlEscape("safe"));
  await safe.text();
  assert.throws(() => safe.clone(), TypeError);
});

test("route wrapper preserves the receiver and labels consumed or locked responses", async () => {
  const owner = {value: 42, GET: withSafeRouteHandler(function () { return Response.json(this.value); })};
  assert.equal(await (await owner.GET()).json(), 42);
  const failed = Response.error();
  assert.equal(await withSafeRouteHandler(() => failed)(), failed);
  for (const locked of [false, true]) {
    const response = new Response("ok");
    const reader = locked ? response.body.getReader() : null;
    if (!locked) await response.text();
    await assert.rejects(withSafeRouteHandler(() => response, "GET /consumed")(), (error) => {
      assert.equal(error.code, "XSS_SBYD_UNSAFE_ROUTE_RESPONSE");
      assert.match(error.message, /GET \/consumed/);
      return true;
    });
    reader?.releaseLock();
  }
});

test("package imports preserve clone; lazy patch works after guard installation across package copies", async () => {
  const {spawnSync} = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import {build} from "esbuild";
    import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
    import {pathToFileURL} from "node:url";
    const original = Response.prototype.clone;
    const api = await import("next-xss-sbyd");
    const enforce = await import("next-xss-sbyd/enforce");
    assert.equal(Response.prototype.clone, original);
    enforce.installResponseGuard();
    // The installation self-test constructs the first authenticated response.
    assert.notEqual(Response.prototype.clone, original);
    await mkdir("tmp", {recursive:true});
    const directory = await mkdtemp("tmp/route-copies-");
    try {
      const bundle = await build({entryPoints:["packages/next-xss-sbyd/src/response.ts"], bundle:true, platform:"node", format:"esm", packages:"external", write:false});
      const path = directory + "/response.mjs";
      await writeFile(path, bundle.outputFiles[0].text);
      const first = await import(pathToFileURL(path));
      const safe = new first.SafeResponse(api.htmlEscape("<copy>"));
      const patched = Response.prototype.clone;
      assert.notEqual(patched, original);
      const second = await import(pathToFileURL(path) + "?second");
      const other = new second.SafeResponse(api.htmlEscape("<second>"));
      assert.equal(Response.prototype.clone, patched);
      for (const value of [safe, other, new api.SafeNextResponse(api.htmlEscape("<next>"))]) {
        const copied = value.clone();
        const checked = await enforce.withSafeRouteHandler(() => copied)();
        assert.match(await checked.text(), /^&lt;/);
        assert.match(await value.text(), /^&lt;/);
      }
      const edge = await import("next-xss-sbyd/route-handler");
      assert.equal(typeof edge.passiveResponse, "function");
      assert.equal(typeof edge.withSafeRouteHandler, "function");
    } finally {await rm(directory, {recursive:true, force:true});}
  `], {encoding:"utf8"});
  assert.equal(result.status, 0, result.stderr);
});
