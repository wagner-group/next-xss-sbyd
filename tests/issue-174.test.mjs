import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer, request as httpRequest} from "node:http";
import test from "node:test";
import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
import {createElement} from "react";
import * as library from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";
import {safeRenderToReadableStream, safeRenderToPipeableStream} from "next-xss-sbyd/render";

/** Exercises an actual Node response, optionally augmented by Next's Pages resolver. */
async function request(handler, {pages = true, headers, method} = {}) {
  let failure;
  async function serve(req, res) {
    try {
      if (pages) await apiResolver(req, res, {}, {default: handler}, {previewModeId: "0123456789abcdef0123456789abcdef"}, true);
      else await handler(req, res);
    } catch (error) {
      failure = error;
      if (res.headersSent) res.destroy();
      else {
        res.statusCode = 500;
        res.removeHeader("content-type");
        res.end();
      }
    }
  }
  const server = createServer(serve);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    // Node's client preserves conditional headers without Fetch adding no-cache.
    const response = await new Promise((resolve, reject) => {
      const outgoing = httpRequest(`http://127.0.0.1:${server.address().port}/`, {
        headers, method, signal: AbortSignal.timeout(10_000),
      }, resolve);
      outgoing.once("error", reject);
      outgoing.end();
    });
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    const responseHeaders = new Headers();
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
      responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
    }
    if (failure) throw failure;
    return {status: response.statusCode, headers: responseHeaders, body: Buffer.concat(chunks).toString("utf8")};
  } catch (error) {
    throw failure ?? error;
  } finally {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

test("safeSend preserves Next status, ETag, conditional GET and HEAD behavior", async () => {
  function handler(_req, res) {
    assert.equal(res.status(201), res);
    assert.equal(res.safeSend(library.htmlEscape("<safe>")), undefined);
  }
  const wrapped = withSafeApiRoute(handler);
  const first = await request(wrapped);
  assert.equal(first.status, 201);
  assert.equal(first.body, "&lt;safe&gt;");
  assert.equal(first.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  assert.equal(first.headers.get("content-length"), String(Buffer.byteLength(first.body)));
  assert.ok(first.headers.get("etag"));
  const cached = await request(wrapped, {headers: {"if-none-match": first.headers.get("etag")}});
  assert.equal(cached.status, 304);
  assert.equal(cached.body, "");
  const head = await request(wrapped, {method: "HEAD"});
  assert.equal(head.body, "");
  assert.equal(head.headers.get("etag"), first.headers.get("etag"));
});

test("safeSend preserves Next bodyless status handling", async () => {
  for (const status of [204, 304]) {
    const response = await request(withSafeApiRoute(function handler(_req, res) {
      res.status(status).safeSend(library.htmlEscape("ignored"));
    }));
    assert.equal(response.status, status);
    assert.equal(response.body, "");
    assert.equal(response.headers.get("content-type"), null);
    assert.equal(response.headers.get("content-length"), null);
  }
});

test("safeEnd uses Node end semantics and safeSend falls back on custom Node handlers", async () => {
  for (const pages of [true, false]) {
    let completed = false;
    const result = await request(withSafeApiRoute(function handler(_req, res) {
      assert.equal(res.safeEnd(library.htmlEscape("<end>"), function completedEnd() { completed = true; }), res);
    }), {pages});
    assert.equal(completed, true);
    assert.equal(result.body, "&lt;end&gt;");
    assert.equal(result.headers.get("etag"), null);
    assert.equal(result.headers.get("content-type"), "text/html; charset=utf-8");
  }
  const result = await request(withSafeApiRoute(function handler(_req, res) {
    assert.equal(res.safeSend(library.htmlEscape("<node>")), undefined);
  }), {pages: false});
  assert.equal(result.body, "&lt;node&gt;");
});

test("standard send, end and write reject all safe body categories before emission", async () => {
  const html = library.htmlEscape("<safe>");
  const stream = await safeRenderToReadableStream(createElement("p", null, "safe"));
  const nodeStream = safeRenderToPipeableStream(createElement("p", null, "safe"));
  const response = await request(withSafeApiRoute(function handler(_req, res) {
    for (const method of ["send", "end", "write"]) {
      for (const body of [html, stream, nodeStream]) {
        assert.throws(() => res[method](body), /safeSend|safeEnd|safePipe|SafeResponse/);
        assert.equal(res.headersSent, false);
      }
    }
    res.json({ok: true});
  }));
  assert.deepEqual(JSON.parse(response.body), {ok: true});
});

test("explicit sinks authenticate input and reject conflicts before sending headers", async () => {
  const stream = await safeRenderToReadableStream("safe");
  const nodeStream = safeRenderToPipeableStream("safe");
  const result = await request(withSafeApiRoute(function handler(_req, res) {
    for (const method of ["safeSend", "safeEnd"]) {
      for (const body of ["raw", null, undefined, {}, stream, nodeStream,
        {privateDoNotAccessOrElseWrappedHtml: "<unsafe>"}]) {
        assert.throws(() => res[method](body), TypeError);
        assert.equal(res.headersSent, false);
      }
      for (const [name, value] of [["content-type", "text/plain"], ["content-type", "text/html; charset=utf-8"], ["x-content-type-options", "off"]]) {
        res.setHeader(name, value);
        assert.throws(() => res[method](library.htmlEscape("safe")), /security header/i);
        assert.equal(res.headersSent, false);
        res.removeHeader(name);
      }
    }
    assert.throws(() => res.safeEnd(library.htmlEscape("safe"), "utf8"), /callback/);
    assert.equal(res.headersSent, false);
    res.setHeader("x-content-type-options", "NoSnIfF");
    res.safeSend(library.htmlEscape("accepted"));
  }));
  assert.equal(result.body, "accepted");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
});

test("safe methods diagnose committed headers without changing the sent response", async () => {
  const html = library.htmlEscape("<first>");
  for (const pages of [true, false]) {
    for (const commit of ["safeSend", "safeEnd", "writeHead", ...(pages ? ["redirect"] : [])]) {
      const result = await request(withSafeApiRoute(function handler(_req, res) {
        if (commit === "writeHead") res.writeHead(202, {"x-committed": "yes"});
        else if (commit === "redirect") res.redirect("/destination");
        else res[commit](html);
        assert.equal(res.headersSent, true);
        for (const method of ["safeSend", "safeEnd"]) {
          assert.throws(() => res[method](html), {
            name: "TypeError",
            message: "response.safeSend() and response.safeEnd() cannot be called after headers were sent",
          });
        }
        if (commit === "writeHead") res.end();
      }), {pages});
      assert.equal(result.status, commit === "redirect" ? 307 : commit === "writeHead" ? 202 : 200);
      assert.equal(result.body, commit === "redirect" ? "/destination" : commit === "writeHead" ? "" : "&lt;first&gt;");
      if (commit === "writeHead") {
        assert.equal(result.headers.get("x-committed"), "yes");
        assert.equal(result.headers.get("content-type"), null);
        assert.equal(result.headers.get("x-content-type-options"), null);
      } else if (commit === "redirect") {
        assert.equal(result.headers.get("location"), "/destination");
        assert.equal(result.headers.get("content-type"), "text/plain; charset=utf-8");
      } else {
        assert.equal(result.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(result.headers.get("x-content-type-options"), "nosniff");
      }
    }
  }
});

test("wrapper methods restore after async failure, nesting and response completion", async () => {
  const result = await request(async function handler(req, res) {
    const originals = Object.fromEntries(["send", "end", "write", "redirect", "safeSend", "safeEnd"].map(name => [name, Object.getOwnPropertyDescriptor(res, name)]));
    const error = new Error("handler failure");
    assert.throws(() => withSafeApiRoute(function failingSync() { throw error; })(req, res), error);
    for (const [name, descriptor] of Object.entries(originals)) assert.deepEqual(Object.getOwnPropertyDescriptor(res, name), descriptor);
    await assert.rejects(withSafeApiRoute(async function failing(_req, response) {
      await Promise.resolve();
      assert.equal(typeof response.safeSend, "function");
      throw error;
    })(req, res), error);
    for (const [name, descriptor] of Object.entries(originals)) assert.deepEqual(Object.getOwnPropertyDescriptor(res, name), descriptor);
    withSafeApiRoute(withSafeApiRoute(function nested(_req, response) {
      response.safeSend(library.htmlEscape("nested"));
    }))(req, res);
    await once(res, "finish");
    for (const [name, descriptor] of Object.entries(originals)) assert.deepEqual(Object.getOwnPropertyDescriptor(res, name), descriptor);
  });
  assert.equal(result.body, "nested");
});

test("safe methods require a wrapper and standalone safeSend is removed", async () => {
  assert.equal("safeSend" in library, false);
  const result = await request(function handler(_req, res) {
    assert.equal(res.safeSend, undefined);
    assert.equal(res.safeEnd, undefined);
    res.json({ok: true});
  });
  assert.equal(result.status, 200);
});

test("safePipe composes with a wrapped real Node response", async () => {
  const result = await request(withSafeApiRoute(function handler(_req, res) {
    library.safePipe(res, safeRenderToPipeableStream(createElement("p", null, "<safe>")));
  }), {pages: false});
  assert.equal(result.body, "<p>&lt;safe&gt;</p>");
  assert.equal(result.headers.get("content-type"), "text/html; charset=utf-8");
});

test("standard methods preserve passive strings, binary, JSON and Node overloads", async () => {
  for (const mediaType of ["text/plain; charset=utf-8", "APPLICATION/JSON", "application/problem+json", "application/vnd.api+json", "application/octet-stream", "text/csv", "text/event-stream"]) {
    let writeCompleted = false;
    let endCompleted = false;
    const result = await request(withSafeApiRoute(function handler(_req, res) {
      res.setHeader("content-type", mediaType);
      assert.equal(typeof res.write("first", "utf8", function wrote() { writeCompleted = true; }), "boolean");
      assert.equal(res.end("last", "utf8", function ended() { endCompleted = true; }), res);
    }));
    assert.equal(result.body, "firstlast");
    assert.equal(writeCompleted, true);
    assert.equal(endCompleted, true);
  }
  for (const body of [{ok: true}, 42, null, undefined, Buffer.from("binary")]) {
    const result = await request(withSafeApiRoute(function handler(_req, res) { res.send(body); }));
    assert.equal(result.body, body == null ? "" : Buffer.isBuffer(body) ? "binary" : JSON.stringify(body));
  }
  const binary = await request(withSafeApiRoute(function handler(_req, res) {
    res.setHeader("content-type", "application/octet-stream");
    res.end(Buffer.from("binary"));
  }));
  assert.equal(binary.body, "binary");
});

test("standard methods reject active and malformed string Content-Types", async () => {
  const result = await request(withSafeApiRoute(function handler(_req, res) {
    for (const mediaType of [undefined, "text/html", "image/svg+xml", "application/javascript", "text/css", "application/xml", "unknown/unknown", "application/unknown", "*/*", "application/+json", "application/problem+json junk", "text/plain;", "text/plain; charset"]) {
      if (mediaType === undefined) res.removeHeader("content-type");
      else res.setHeader("content-type", mediaType);
      for (const method of ["send", "end", "write"]) {
        assert.throws(() => res[method]("unsafe"), /raw string response/i);
        assert.equal(res.headersSent, false);
      }
    }
    res.removeHeader("content-type");
    res.end();
  }));
  assert.equal(result.body, "");
});

test("safe methods remain installed for callback and awaited Node handlers", async () => {
  for (const asynchronous of [false, true]) {
    function delayed(_req, res) {
      setImmediate(function sendLater() { res.safeEnd(library.htmlEscape("delayed")); });
    }
    async function awaited(_req, res) {
      await new Promise(resolve => setImmediate(resolve));
      res.safeEnd(library.htmlEscape("delayed"));
    }
    const response = await request(withSafeApiRoute(asynchronous ? awaited : delayed), {pages: false});
    assert.equal(response.body, "delayed");
  }
});

test("Next draft mode and redirects retain their native side effects", async () => {
  const draft = await request(withSafeApiRoute(function handler(_req, res) {
    assert.equal(res.setDraftMode({enable: true}), res);
    res.safeSend(library.htmlEscape("draft"));
  }));
  assert.equal(draft.body, "draft");
  assert.match(draft.headers.get("set-cookie"), /__prerender_bypass=/);
  for (const status of [302, 307]) {
    const redirected = await request(withSafeApiRoute(function handler(_req, res) {
      if (status === 307) assert.equal(res.redirect("/destination"), res);
      else assert.equal(res.redirect(status, "/destination"), res);
    }));
    assert.equal(redirected.status, status);
    assert.equal(redirected.headers.get("location"), "/destination");
    assert.equal(redirected.headers.get("content-type"), "text/plain; charset=utf-8");
  }
  const passive = await request(withSafeApiRoute(function handler(_req, res) {
    res.setHeader("content-type", "text/plain; charset=us-ascii");
    res.redirect("/preserved");
  }));
  assert.equal(passive.headers.get("content-type"), "text/plain; charset=us-ascii");
  const rejected = await request(withSafeApiRoute(function handler(_req, res) {
    res.setHeader("content-type", "text/html");
    assert.throws(() => res.redirect("/blocked"), /raw string response/i);
    assert.equal(res.headersSent, false);
    res.removeHeader("content-type");
    res.safeEnd(library.htmlEscape("rejected"));
  }));
  assert.equal(rejected.body, "rejected");
  assert.equal(rejected.headers.get("location"), null);
});

test("closing an unfinished Node response restores wrapper methods", async () => {
  let verifyClosed;
  const closed = new Promise((resolve, reject) => { verifyClosed = {resolve, reject}; });
  const server = createServer(function handler(req, res) {
    const originals = Object.fromEntries(["send", "end", "write", "redirect", "safeSend", "safeEnd"].map(name => [name, Object.getOwnPropertyDescriptor(res, name)]));
    withSafeApiRoute(function wrapped(_req, response) { response.destroy(); })(req, res);
    res.once("close", function verifyRestored() {
      try {
        for (const [name, descriptor] of Object.entries(originals)) assert.deepEqual(Object.getOwnPropertyDescriptor(res, name), descriptor);
        verifyClosed.resolve();
      } catch (error) { verifyClosed.reject(error); }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${server.address().port}/`, {signal: AbortSignal.timeout(10_000)}));
    await closed;
  } finally {
    server.closeAllConnections();
    const stopped = once(server, "close");
    server.close();
    await stopped;
  }
});
