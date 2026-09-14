import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {connect, createServer as createHttp2Server} from "node:http2";
import test from "node:test";
import {htmlEscape} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

test("custom Node handlers can end with SafeHtml", async () => {
  const server = createServer(withSafeApiRoute((_req, res) => res.safeEnd(htmlEscape("<safe>"))));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(await response.text(), "&lt;safe&gt;");
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
});

for (const method of ["safeEnd", "safeSend"]) {
  test(`custom HTTP/2 handlers support ${method}`, {timeout: 10_000}, async () => {
    let completed = false;
    const server = createHttp2Server(withSafeApiRoute((_req, res) => {
      assert.throws(() => res.end(htmlEscape("rejected")), /safeEnd|safeSend/);
      if (method === "safeEnd") {
        assert.equal(res.safeEnd(htmlEscape("<safe>"), () => { completed = true; }), res);
      } else {
        assert.equal(res.safeSend(htmlEscape("<safe>")), undefined);
      }
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = connect(`http://127.0.0.1:${server.address().port}`);
    try {
      const request = client.request({":path": "/"});
      request.setEncoding("utf8");
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      const [headers] = await once(request, "response");
      await once(request, "end");
      assert.equal(body, "&lt;safe&gt;");
      assert.equal(headers["content-type"], "text/html; charset=utf-8");
      assert.equal(headers["x-content-type-options"], "nosniff");
      if (method === "safeEnd") assert.equal(completed, true);
    } finally {
      const clientClosed = once(client, "close");
      client.destroy();
      await clientClosed;
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });

}
