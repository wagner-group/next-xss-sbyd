import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer, get} from "node:http";
import test from "node:test";
import {gunzipSync} from "node:zlib";
import compression from "compression";
import {createElement, Suspense, use} from "react";
import {safePipe} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";
import {safeRenderToPipeableStream} from "next-xss-sbyd/render";

/** Runs a real HTTP server, including deterministic cleanup after failures. */
async function serve(t, guarded, handler, middleware) {
  const route = guarded ? withSafeApiRoute(handler) : handler;
  const server = createServer(function dispatch(req, res) {
    if (middleware) middleware(req, res, function next() { route(req, res); });
    else route(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async function close() {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

// Real post-shell renderer failures in render.test.mjs and issue-203.test.mjs
// exercise the shared sink's error callback; cover backpressure and close here.
for (const guarded of [false, true]) {
  for (const encoding of ["gzip", "identity"]) {
    test(`safePipe completes behind compression middleware (${encoding}, guarded=${guarded})`, {timeout: 5_000}, async (t) => {
      const errors = [];
      const origin = await serve(t, guarded, function handler(_req, res) {
        safePipe(res, safeRenderToPipeableStream(createElement("main", null, "<safe>".repeat(20_000))), {
          onError(error) { errors.push(error); },
        });
      }, compression());
      const response = await new Promise(function request(resolve, reject) {
        const req = get(origin, {headers: {"accept-encoding": encoding}}, function received(res) {
          const chunks = [];
          res.on("data", function data(chunk) { chunks.push(chunk); });
          res.once("error", reject);
          res.once("end", function end() {
            resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)});
          });
        });
        req.once("error", reject);
        t.after(function closeRequest() { req.destroy(); });
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.equal(response.headers["content-encoding"], encoding === "gzip" ? "gzip" : undefined);
      const body = encoding === "gzip" ? gunzipSync(response.body) : response.body;
      assert.equal(body.toString(), `<main>${"&lt;safe&gt;".repeat(20_000)}</main>`);
      assert.deepEqual(errors, []);
    });
  }

  test(`safePipe preserves large output with a paused HTTP client (guarded=${guarded})`, {timeout: 10_000}, async (t) => {
    const text = "<safe>".repeat(500_000);
    const errors = [];
    const origin = await serve(t, guarded, function handler(_req, res) {
      safePipe(res, safeRenderToPipeableStream(createElement("main", null, text)), {
        status: 201,
        onError(error) { errors.push(error); },
      });
    });
    const response = await new Promise(function request(resolve, reject) {
      get(origin, function received(res) {
        res.pause();
        setTimeout(function resume() { res.resume(); }, 50);
        const chunks = [];
        res.on("data", function data(chunk) { chunks.push(chunk); });
        res.once("error", reject);
        res.once("end", function end() {
          resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()});
        });
      }).once("error", reject);
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.body, `<main>${"&lt;safe&gt;".repeat(500_000)}</main>`);
    assert.deepEqual(errors, []);
  });

  test(`safePipe aborts pending rendering when the client disconnects (guarded=${guarded})`, {timeout: 5_000}, async (t) => {
    let reportError;
    const aborted = new Promise(function pending(resolve) { reportError = resolve; });
    let finished = false;
    const pending = new Promise(function unresolved() {});
    function Deferred() { use(pending); return createElement("p", null, "done"); }
    const origin = await serve(t, guarded, function handler(_req, res) {
      res.once("finish", function finish() { finished = true; });
      safePipe(res, safeRenderToPipeableStream(createElement("html", null,
        createElement("body", null, createElement(Suspense, {fallback: "waiting"}, createElement(Deferred))))), {
        onError(error) { reportError(error); },
      });
    });
    await new Promise(function disconnect(resolve, reject) {
      get(origin, function received(res) {
        res.once("data", function data() { res.destroy(); resolve(); });
        res.once("error", reject);
      }).once("error", reject);
    });
    assert.ok(await aborted instanceof Error);
    assert.equal(finished, false);
  });
}
