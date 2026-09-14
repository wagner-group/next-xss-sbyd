import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import test from "node:test";

import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
import {htmlEscape} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

/** Sends a real HTTP request to an isolated Node handler and closes its server. */
async function request(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    return {status: response.status, headers: response.headers, body: await response.text()};
  } finally {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

test("real Pages resolver retains SafeHtml headers and ETag", async () => {
  const response = await request(function serve(req, res) {
    return apiResolver(req, res, {}, {
      default: withSafeApiRoute(function page(_req, response) {
        response.safeSend(htmlEscape("<safe>"));
      }),
    }, {}, true);
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, "&lt;safe&gt;");
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("etag"));
});
