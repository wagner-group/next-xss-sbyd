import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {once} from "node:events";
import {createServer} from "node:http";
import {promisify} from "node:util";
import test from "node:test";
import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
import {createElement, Suspense, use} from "react";
import {htmlEscape, safePipe} from "next-xss-sbyd";
import {safeRenderToPipeableStream} from "next-xss-sbyd/render";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

const payload = '<!doctype html><script>window.xssProof="executed"</script>';
const execFileAsync = promisify(execFile);

/** Exercises the actual Pages resolver and captures rejected writes before responding. */
async function request(handler) {
  let failure;
  let committed;
  const server = createServer(function serve(req, res) {
    apiResolver(req, res, {}, {default: withSafeApiRoute(handler)}, {}, true, true).catch(function reject(error) {
      failure = error;
      committed = res.headersSent;
      if (committed) res.end();
      else {
        for (const name of res.getHeaderNames()) res.removeHeader(name);
        res.writeHead(500, {"Content-Type": "text/plain"});
        res.end("rejected");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {signal: AbortSignal.timeout(10_000)});
    const body = Buffer.from(await response.arrayBuffer());
    return {status: response.status, headers: response.headers, body, failure, committed};
  } finally {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

for (const method of ["write", "end", "send"]) {
  test(`Pages ${method} rejects active and malformed byte bodies before committing headers`, async () => {
    for (const contentType of [undefined, "text/html", "image/svg+xml", "application/json, text/html", "text/plain;"]) {
      // Next itself infers application/octet-stream for an untyped send(Buffer).
      if (method === "send" && contentType === undefined) continue;
      for (const bytes of [Buffer.from(payload), new TextEncoder().encode(payload)]) {
        // Next serializes Uint8Array as JSON; it only treats Buffer as binary.
        if (method === "send" && !Buffer.isBuffer(bytes)) continue;
        const result = await request(function handler(_req, res) {
          if (contentType !== undefined) res.setHeader("Content-Type", contentType);
          res[method](bytes);
          if (method === "write") res.end();
        });
        assert.equal(result.failure?.name, "TypeError", `${method}: ${contentType}`);
        assert.match(result.failure.message, /allowlisted passive Content-Type/u);
        assert.equal(result.committed, false);
        assert.equal(result.status, 500);
        assert.equal(result.body.toString(), "rejected");
      }
    }
  });
}

test("Pages guards the effective Content-Type supplied by writeHead", async () => {
  for (const headers of [{"Content-Type": "text/html"}, ["Content-Type", "text/html"],
    ["Content-Type", "text/html", "Content-Type", "text/plain"],
    ["Content-Type", "text/plain", "Content-Type", "text/html"]]) {
    const result = await request(function handler(_req, res) {
      res.setHeader("Content-Type", "text/plain");
      res.writeHead(200, "OK", headers);
      res.end(Buffer.from(payload));
    });
    assert.equal(result.failure?.name, "TypeError");
    assert.equal(result.body.length, 0);
  }
  const result = await request(function handler(_req, res) {
    res.writeHead(200, {"Content-Type": "application/octet-stream"});
    res.end(Buffer.from(payload));
  });
  assert.equal(result.failure, undefined);
  assert.equal(result.body.toString(), payload);
  const untyped = await request(function handler(_req, res) {
    res.flushHeaders();
    res.end(Buffer.from(payload));
  });
  assert.equal(untyped.failure?.name, "TypeError");
  assert.equal(untyped.body.length, 0);
});

for (const statusMessage of [undefined, null]) {
  for (const body of [payload, Buffer.from(payload)]) {
    test(`Pages writeHead rejects HTML with ${statusMessage} status message and ${typeof body} body`, async () => {
      const result = await request(function handler(_req, res) {
        res.setHeader("Content-Type", "text/plain");
        res.writeHead(200, statusMessage, {"Content-Type": "text/html"});
        res.end(body);
      });
      assert.equal(result.failure?.name, "TypeError");
      assert.match(result.failure.message, /allowlisted passive Content-Type/u);
      assert.equal(result.body.length, 0);
    });
  }
}

test("Pages writeHead honors third-argument precedence without a status message", async () => {
  const result = await request(function handler(_req, res) {
    res.setHeader("Content-Type", "text/plain");
    res.writeHead(200, {"Content-Type": "text/plain"}, {"Content-Type": "text/html"});
    res.end(payload);
  });
  assert.equal(result.failure?.name, "TypeError");
  assert.equal(result.body.length, 0);
});

test("Pages writeHead accepts passive nested header pairs and rejects active or duplicate pairs", async () => {
  for (const headers of [
    [["Content-Type", "application/octet-stream"]],
    [["X-Trace", "present"], ["Content-Type", "application/octet-stream"]],
    [["Content-Type", "text/html"]],
    [["Content-Type", "text/plain"], ["Content-Type", "text/html"]],
  ]) {
    const passive = headers.some(([name, value]) => name === "Content-Type" && value === "application/octet-stream");
    const result = await request(function handler(_req, res) {
      res.writeHead(200, headers);
      res.end(Buffer.from(payload));
    });
    if (passive) {
      assert.equal(result.failure, undefined);
      assert.equal(result.headers.get("content-type"), "application/octet-stream");
      assert.equal(result.body.toString(), payload);
    } else {
      assert.equal(result.failure?.name, "TypeError");
      assert.equal(result.body.length, 0);
    }
  }
});

test("Pages writeHead preserves passive types with unrelated and omitted header entries", async () => {
  for (const headers of [null, {}, [], {"X-Trace": "present"},
    ["X-Trace", "present", "Content-Type", "application/octet-stream"]]) {
    const result = await request(function handler(_req, res) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.writeHead(200, headers);
      res.end(Buffer.from(payload));
    });
    assert.equal(result.failure, undefined);
    assert.equal(result.body.toString(), payload);
  }
});

test("Pages preserves passive bytes, inferred Buffer downloads, empty bodies, and Node overloads", async () => {
  for (const contentType of ["text/plain", "application/json", "application/problem+json", "Application/Octet-Stream; charset=utf-8"]) {
    let writes = 0;
    let ends = 0;
    const result = await request(function handler(_req, res) {
      res.setHeader("Content-Type", contentType);
      assert.equal(typeof res.write(Buffer.from("a"), function written() { writes++; }), "boolean");
      res.write(new Uint8Array([98]), "utf8", function written() { writes++; });
      assert.equal(res.end(Buffer.from("c"), "utf8", function ended() { ends++; }), res);
    });
    assert.equal(result.failure, undefined);
    assert.equal(result.body.toString(), "abc");
    assert.equal(writes, 2);
    assert.equal(ends, 1);
  }
  const inferred = await request(function handler(_req, res) { res.send(Buffer.from(payload)); });
  assert.equal(inferred.failure, undefined);
  assert.equal(inferred.headers.get("content-type"), "application/octet-stream");
  assert.equal(inferred.body.toString(), payload);
  for (const empty of [undefined, "", Buffer.alloc(0), new Uint8Array(0)]) {
    const result = await request(function handler(_req, res) { res.end(empty); });
    assert.equal(result.failure, undefined);
    assert.equal(result.body.length, 0);
  }
  let completed = false;
  const empty = await request(function handler(_req, res) { res.end(function ended() { completed = true; }); });
  assert.equal(empty.failure, undefined);
  assert.equal(completed, true);
});

test("Pages retains authenticated safeSend, safeEnd, and safePipe", async () => {
  for (const method of ["safeSend", "safeEnd"]) {
    const result = await request(function handler(_req, res) { res[method](htmlEscape("<safe>")); });
    assert.equal(result.failure, undefined);
    assert.equal(result.body.toString(), "&lt;safe&gt;");
    assert.equal(result.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  }
  const result = await request(function handler(_req, res) {
    safePipe(res, safeRenderToPipeableStream(createElement("main", null, "<safe>")));
  });
  assert.equal(result.failure, undefined);
  assert.equal(result.body.toString(), "<main>&lt;safe&gt;</main>");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
});

test("authenticated stream sinks preserve queued output without authorizing ordinary writes", async () => {
  const text = "<safe>".repeat(50_000);
  let attempted = false;
  let target;
  function Content() {
    attempted = true;
    assert.throws(() => target.write(Buffer.from(payload)), /allowlisted passive Content-Type/u);
    return createElement("main", null, text);
  }
  const result = await request(function handler(_req, res) {
    target = res;
    const sink = Symbol.for("next-xss-sbyd.response.safe-node-stream-sink.v1");
    assert.throws(() => res[sink]({}), /authenticated SafeNodeStream/u);
    assert.throws(() => res[sink](htmlEscape("safe")), /authenticated SafeNodeStream/u);
    res.once("finish", function finished() {
      assert.equal(Object.hasOwn(res, sink), false);
    });
    safePipe(res, safeRenderToPipeableStream(createElement(Content)));
  });
  assert.equal(attempted, true);
  assert.equal(result.failure, undefined);
  assert.equal(result.body.toString(), `<main>${"&lt;safe&gt;".repeat(50_000)}</main>`);
});

test("guarded safePipe retains its passive shell-error response", async () => {
  const errors = [];
  function Broken() { throw new Error("rendering failed"); }
  const result = await request(function handler(_req, res) {
    safePipe(res, safeRenderToPipeableStream(createElement(Broken)), {
      onError(error) { errors.push(error); },
    });
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.toString(), "Internal Server Error");
  assert.equal(result.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(errors[0].message, "rendering failed");
});

test("authenticated piping keeps its private writable out of the completion callback", async () => {
  let completed = false;
  const result = await request(function handler(_req, res) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const pipe = res[Symbol.for("next-xss-sbyd.response.safe-node-stream-sink.v1")];
    assert.equal(pipe(safeRenderToPipeableStream("<safe>"), function complete() {
      assert.equal(this, undefined);
      completed = true;
      res.end();
    }), undefined);
  });
  assert.equal(result.failure, undefined);
  assert.equal(result.body.toString(), "&lt;safe&gt;");
  assert.equal(completed, true);
});

test("guarded safePipe aborts when rendering fails after the shell", async () => {
  const errors = [];
  let finished = false;
  await assert.rejects(request(function handler(_req, res) {
    let rejectContent;
    const content = new Promise(function pending(_resolve, reject) { rejectContent = reject; });
    function Deferred() { use(content); return createElement("p", null, "done"); }
    res.once("finish", function finish() { finished = true; });
    safePipe(res, safeRenderToPipeableStream(createElement("html", null,
      createElement("body", null, createElement("p", null, "shell"),
        createElement(Suspense, {fallback: "waiting"}, createElement(Deferred))))), {
      onError(error) { errors.push(error); },
    });
    setTimeout(function fail() { rejectContent(new Error("late failure")); }, 30);
  }));
  assert.equal(finished, false);
  assert.ok(errors.some((error) => error.message === "late failure"));
});

// Node versions either destroy the socket or propagate a thrown pipe write.
// Isolate the real stream/server so either rejection can be observed safely.
test("Pages rejects untyped or active Readable.pipe bytes and preserves passive streams", async () => {
  const program = `
    import assert from "node:assert/strict";
    import {once} from "node:events";
    import {createServer} from "node:http";
    import {Readable} from "node:stream";
    import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
    import {withSafeApiRoute} from "next-xss-sbyd/enforce";
    const payload = ${JSON.stringify(payload)};
    for (const contentType of [undefined, "text/html", "text/plain;", "application/octet-stream"]) {
      let response;
      let source;
      let failure;
      function rejected(error) {
        failure = error;
        assert.equal(response.headersSent, false);
        source.unpipe(response);
        source.destroy();
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain");
        response.end("rejected");
      }
      process.setUncaughtExceptionCaptureCallback(rejected);
      const server = createServer(function serve(req, res) {
        response = res;
        req.socket.once("error", function failed(error) { failure = error; });
        apiResolver(req, res, {}, {default: withSafeApiRoute(function handler(_req, res) {
          if (contentType !== undefined) res.setHeader("Content-Type", contentType);
          source = Readable.from([Buffer.from(payload)]);
          source.pipe(res);
        })}, {}, true).catch(rejected);
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        let result;
        let body;
        let networkError;
        try {
          result = await fetch("http://127.0.0.1:" + server.address().port, {signal: AbortSignal.timeout(10000)});
          body = await result.text();
        } catch (error) { networkError = error; }
        if (contentType === "application/octet-stream") {
          assert.equal(failure, undefined);
          assert.equal(networkError, undefined);
          assert.equal(result.status, 200);
          assert.equal(body, payload);
        } else {
          assert.equal(failure?.name, "TypeError");
          assert.match(failure.message, /allowlisted passive Content-Type/);
          if (networkError === undefined) {
            assert.equal(result.status, 500);
            assert.equal(body, "rejected");
          } else assert.equal(networkError.name, "TypeError");
        }
      } finally {
        process.setUncaughtExceptionCaptureCallback(null);
        server.closeAllConnections();
        const closed = once(server, "close");
        server.close();
        await closed;
      }
    }
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: new URL("../", import.meta.url), timeout: 30_000,
  });
});
